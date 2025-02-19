const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const axios = require('axios');
const mammoth = require("mammoth");
const { google } = require('googleapis');

require('dotenv').config();

const app = express();

app.use(cors()); // Enable CORS for all routes

const PORT = process.env.PORT || 3001;

//const PAPER_DIR = path.join(process.cwd(), "data/papers");
//const SCORE_DIR = path.join(process.cwd(), "data/scores");
const tooltipFile = path.join(process.cwd(), "data/Tooltips.docx");
const bibliographyFile = path.join(process.cwd(), "data/Bibliography_EmpiricalSample.docx");

class ScopusAPI {
  constructor(apiKey) {
      this.apiKey = apiKey;
      this.baseUrl = 'https://api.elsevier.com/content/search/scopus';
      this.headers = {
          'Accept': 'application/json',
          'X-ELS-APIKey': this.apiKey,
          'Content-Type': 'application/json'
      };
  }

  async searchDOIs(dois) {
      if (!Array.isArray(dois) || dois.length === 0) {
        console.error('Invalid DOIs array:', dois);
        throw new Error('Invalid DOIs input');
      }

      // Construct query with OR operators
      const query = dois.map(doi => `DOI(${doi})`).join(' OR ');
      
      try {
          const response = await axios.get(this.baseUrl, {
              headers: this.headers,
              params: {
                  query: query,
                  field: 'citedby-count,doi,title',
                  count: 20  // Number of results per page
              }
          });

          // Process results and match them back to input DOIs
          const results = new Map();
          dois.forEach(doi => {
              results.set(doi, {
                  doi,
                  status: 'not_found',
                  citationCount: 0
              });
          });

          if (response.data['search-results']?.entry) {
              response.data['search-results'].entry.forEach(entry => {
                  const doi = entry['prism:doi'];
                  results.set(doi, {
                      doi: doi,
                      title: entry['dc:title'],
                      citationCount: entry['citedby-count'],
                      status: 'success'
                  });
              });
          }

          return Array.from(results.values());

      } catch (error) {
          console.error('Scopus API Error:', error.message);
          // Return error status for all DOIs in this batch
          return dois.map(doi => ({
              doi,
              status: 'error',
              error: error.message,
              citationCount: 0
          }));
      }
  }

  async batchSearch(dois, batchSize = 20) {  // Increased batch size since we're doing fewer requests
      const results = [];
      const batches = [];

      // Split DOIs into batches
      for (let i = 0; i < dois.length; i += batchSize) {
          batches.push(dois.slice(i, i + batchSize));
      }

      // Process each batch
      for (const [index, batch] of batches.entries()) {
          console.log(`Processing batch ${index + 1}/${batches.length} (${batch.length} DOIs)`);
          
          try {
              const batchResults = await this.searchDOIs(batch);
              results.push(...batchResults);

              // Add a small delay between batches to be nice to the API
              if (index < batches.length - 1) {
                  await new Promise(resolve => setTimeout(resolve, 500));
              }
          } catch (error) {
              console.error(`Error processing batch ${index + 1}:`, error.message);
              // Continue with next batch even if one fails
          }
      }

      return results;
  }
}
// // Function to get citation count for a single DOI
// async function getCitationCount(doi) {
//   const url = `https://api.elsevier.com/content/abstract/doi/${doi}`;
//   const headers = {
//     "X-ELS-APIKey": apiKey,
//     "Accept": "application/json",
//   };

//   try {
//     const response = await axios.get(url, { headers });
//     if (response.status === 200) {
//       const citationCount = response.data?.["abstracts-retrieval-response"]?.coredata?.["citedby-count"] || "N/A";
//       return { doi, citationCount };
//     } else {
//       return { doi, error: `Failed with status code: ${response.status}` };
//     }
//   } catch (error) {
//     return { doi, error: error.response?.data || error.message };
//   }
// }

// Function to parse metadata of papers in TSV format, then extract citation count for each paper and save as JSON
const importPapers = async (directory) => {
  if (!fs.existsSync(directory)) {
    throw new Error(`Directory not found: ${directory}`);
  }

  return new Promise((resolve, reject) => {
    let allData = [];

    fs.readdir(directory, (err, files) => {
      if (err) {
        console.error('Directory read error:', err);
        reject(new Error(`Failed to read directory: ${err.message}`));
        return;
      }

      if (!files.length) {
        console.warn('No files found in directory');
        resolve([]);
        return;
      }

      const fileReadPromises = files
        .filter(file => file.endsWith('.tsv'))
        .map((file, index) => {
          return new Promise((res, rej) => {
            const filePath = path.join(directory, file);
            console.log(`Processing file: ${filePath}`);

            fs.readFile(filePath, "utf-8", (err, data) => {
              if (err) {
                console.error(`File read error (${file}):`, err);
                rej(err);
                return;
              }

              try {
                const lines = data.trim().split("\n");
                const headers = lines[0].split("\t");
                const fileData = lines.slice(1).map(line => {
                  const values = line.split("\t");
                  const obj = {};
                  headers.forEach((header, i) => obj[header] = values[i]);
                  obj.sourceFile = index;
                  return obj;
                });

                allData = [...allData, ...fileData];
                res();
              } catch (parseError) {
                console.error(`Parse error (${file}):`, parseError);
                rej(parseError);
              }
            });
          });
        });

        Promise.all(fileReadPromises)
        .then(async () => {
          try {
            const scopus = new ScopusAPI(process.env.SCOPUS_API_KEY);
            const dois = allData.filter(d => d.DOI).map(d => d.DOI);
            
            if (!dois.length) {
              console.warn('No DOIs found in data');
              resolve(allData);
              return;
            }

            const results = await scopus.batchSearch(dois);
            
            allData.forEach(item => {
              if (item.DOI) {
                const result = results.find(d => d.doi === item.DOI);
                item.citationCount = result?.citationCount || 0;
              }
            });

            if (process.env.NODE_ENV !== 'production') {
              const fileNameOutput = path.join(__dirname, "data/output/final_papers_full_citations.json");
              fs.writeFileSync(fileNameOutput, JSON.stringify(allData, null, 2));
            }

            resolve(allData);
          } catch (error) {
            console.error('Citation processing error:', error);
            reject(error);
          }
        })
        .catch(error => {
          console.error('File processing error:', error);
          reject(error);
        });

    });
  });
};

const columnMapping = {
  "Are Consumers addressed as Actors in this research?": "Act_Cons",
  "Are Consumers Self-Oriented in this article?": "Cons_Self",
  "Are Consumers Societally-Oriented in this article?": "Cons_Soc",
  "Are Consumers Environmentally-Oriented in this article?": "Cons_Env",
  "Are Businesses addressed as Actors in this research?": "Act_Busi",
  "Are Businesses Profit-Oriented in this article?": "Busi_Prof",
  "Are Businesses Societally-Oriented in this article?": "Busi_Soc",
  "Are Businesses Environmentally-Oriented in this article?": "Busi_Env",
  "Are Institutions addressed as Actors in this research?": "Act_Inst", 
  "Are Institutions Growth-Oriented in this article?": "Inst_Gro",
  "Are Institutions Societally-Oriented in this article?": "Inst_Soc",
  "Are Institutions Environmentally-Oriented in this article?": "Inst_Env",
  "What is the Scope of Sustainability in this article?": "SP"
};

const transformRow = (row) => {
  let transformedRow = {};

  Object.entries(row).forEach(([key, value]) => {
    // Convert "Yes" → 1 and "No" → 0
    let newValue = value === "Yes" ? 1 : value === "No" ? 0 : value;

    // Rename column if it exists in mapping, otherwise keep the original name
    let newKey = columnMapping[key] || key;

    transformedRow[newKey] = newValue;
  });

  return transformedRow;
};

// Function to parse metadata of scores for papers in CSV format, perform data transformation and save as JSON
const importScores = async (directory) => {

  if (!fs.existsSync(directory)) {
    throw new Error(`Directory not found: ${directory}`);
  }

  return new Promise((resolve, reject) => {
    let allData = [];

    fs.readdir(directory, (err, files) => {
      if (err) {
        console.error('Score directory read error:', err);
        reject(err);
        return;
      }

      const fileReadPromises = files
        .filter(file => file.endsWith('.csv'))
        .map((file, index) => {
          return new Promise((res, rej) => {
            const filePath = path.join(directory, file);
            console.log(`Processing score file: ${filePath}`);
            
            const fileData = [];
            fs.createReadStream(filePath)
              .on('error', error => {
                console.error(`Score file read error (${file}):`, error);
                rej(error);
              })
              .pipe(csv())
              .on('data', row => {
                const transformedRow = transformRow(row);
                transformedRow.sourceFile = index;
                fileData.push(transformedRow);
              })
              .on('end', () => {
                allData = [...allData, ...fileData];
                res();
              })
              .on('error', error => {
                console.error(`CSV parsing error (${file}):`, error);
                rej(error);
              });
          });
        });

      Promise.all(fileReadPromises)
        .then(async () => {
          if (process.env.NODE_ENV !== 'production') {
            const fileNameOutput = path.join(__dirname, "data/output/scores_full.json");
            fs.writeFileSync(fileNameOutput, JSON.stringify(allData, null, 2));
          }
          resolve(allData);
        })
        .catch(error => {
          console.error('Score processing error:', error);
          reject(error);
        });
    });
  });
};

// Function to parse bibliography from each paragraph in word document 
const importBibliography = async(filePath) => {
  try {
    // Read the DOCX file as a buffer
    const buffer = fs.readFileSync(filePath);

    // Extract text from the DOCX file
    const { value } = await mammoth.extractRawText({ buffer });

    // Split text into paragraphs
    const paragraphs = value.split("\n").filter(p => p.trim() !== "");

    return paragraphs;
  } catch (error) {
    console.error("Error reading Bibliography DOCX file:", error);
    return [];
  }
}

// Function to parse tooltip content from each paragraph in word document 
const importTooltipContent = async (filePath) => {
  try {
    // Read the DOCX file as a buffer
    const buffer = fs.readFileSync(filePath);

    // Extract text from the DOCX file
    const { value } = await mammoth.extractRawText({ buffer });

    // Split text into paragraphs
    const paragraphs = value.split("\n").filter(p => p.trim() !== "");
 
    const sections = {
      "Actors": [],
      "Value Orientations": [],
      "Scope of Sustainability": []
    };
    
    let currentKey = null;

    paragraphs.forEach(paragraph => {
      const normalized = paragraph.trim();

      if (sections.hasOwnProperty(normalized)) {
        currentKey = normalized;  // Update the current section key
      } else if (currentKey) {
        sections[currentKey].push(paragraph);  // Assign paragraph to the correct section
      }
    });

    return sections;
  } catch (error) {
    console.error("Error reading Tooltip DOCX file:", error);
    return {};
  }
};

const importFromGoogleSheets = async (spreadsheetId, sheetNames) => {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    console.log(JSON.stringify(credentials))
    // Verify required credential fields
    const requiredFields = ['client_email', 'private_key', 'project_id'];
    requiredFields.forEach(field => {
      if (!credentials[field]) {
        throw new Error(`Missing required credential field: ${field}`);
      }
    });
    
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
 
    let allDataPapers = [];
    let allDataScores = [];

    try {
      await sheets.spreadsheets.get({
        spreadsheetId,
      });
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new Error(`Spreadsheet ID ${spreadsheetId} not found or not accessible. Make sure you've shared it with ${credentials.client_email}`);
      }
      throw error;
    }

    for (const sheetName of sheetNames) {
      try {
        console.log(`Fetching data from sheet: ${sheetName}`);
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${sheetName}!A:Z`,
        });

        const rows = response.data.values;
        if (!rows || rows.length < 2) {
          console.warn(`No data found in sheet: ${sheetName}`);
          continue;
        }

        const headers = rows[0];
        const sheetData = rows.slice(1).map((row, index) => {
          let obj = {};
          headers.forEach((header, i) => obj[header] = row[i] || '');
          obj.sourceFile = sheetName; // Track which sheet the row came from

          if(sheetName === 'Coding_SM' || sheetName === 'Coding_S') {
            obj = transformRow(obj);
          }
          return obj;
        });
        
        if(sheetName === 'SustainabMarketing' || sheetName === 'Sustainab') {
          allDataPapers = [...allDataPapers, ...sheetData];
        }
        if(sheetName === 'Coding_SM' || sheetName === 'Coding_S') {
          allDataScores = [...allDataScores, ...sheetData];
        }
      } catch (error) {
        console.error(`Error fetching sheet ${sheetName}:`, error.message);
        throw new Error(`Failed to fetch sheet "${sheetName}": ${error.message}`);     
      }
    }

    const scopus = new ScopusAPI(process.env.SCOPUS_API_KEY);
    const dois = allDataPapers.filter(d => d.DOI).map(d => d.DOI);

    if (!dois.length) {
      console.warn('No DOIs found in data');
      return allDataPapers;
    }

    const results = await scopus.batchSearch(dois);
    allDataPapers.forEach(item => {
      if (item.DOI) {
        const result = results.find(d => d.doi === item.DOI);
        item.citationCount = result?.citationCount || 0;
      }
    });

    if (process.env.NODE_ENV !== 'production') {
      const fileNameOutput = path.join(__dirname, 'data/output/final_papers_full_citations.json');
      fs.writeFileSync(fileNameOutput, JSON.stringify(allDataPapers, null, 2));

      const fileNameOutput1 = path.join(__dirname, "data/output/scores_full.json");
      fs.writeFileSync(fileNameOutput1, JSON.stringify(allDataScores, null, 2));
    }

    return {papers: allDataPapers, scores: allDataScores};
  } catch (error) {
    const errorMessage = `
      Google Sheets import failed: ${error.message}
      
      Please check:
      1. credentials.json exists and is valid
      2. Spreadsheet ID is correct: ${spreadsheetId}
      3. Service account email has access to the spreadsheet
      4. Sheet names are correct: ${sheetNames.join(', ')}
    `;
    throw new Error(errorMessage);
  }
};

// API route to fetch transformed data
app.get("/api/data", async (req, res) => {
  try {
    const [sheetsData, bibliography, tooltipContent] = await Promise.all([
      importFromGoogleSheets(process.env.GOOGLE_SHEET_ID, ['SustainabMarketing', 'Sustainab', 'Coding_SM', 'Coding_S']).catch(err => {
        console.error('Papers and Scores import from google sheets failed:', err);
        return { papers: [], scores: [] };;
      }),
      // importPapers(PAPER_DIR).catch(err => {
      //   console.error('Papers import failed:', err);
      //   throw err;
      // }),
      // importScores(SCORE_DIR).catch(err => {
      //   console.error('Scores import failed:', err);
      //   throw err;
      // }),

      importBibliography(bibliographyFile).catch(err => {
        console.error('Bibliography import failed:', err);
        return [];
      }),
      importTooltipContent(tooltipFile).catch(err => {
        console.error('Tooltip import failed:', err);
        return {};
      })
    ]);

    console.log('Data processing summary:', {
      papers: sheetsData.papers.length,
      scores: sheetsData.scores.length,
      bibliography: bibliography.length,
      tooltips: Object.keys(tooltipContent).length
    });

    res.json({ papers: sheetsData.papers, scores: sheetsData.scores, bibliography, tooltipContent });
  } catch (error) {
    console.error('API endpoint error:', error);
    res.status(500).json({
      error: 'Data processing failed',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
}).on('error', (error) => {
  console.error('Server startup error:', error);
});