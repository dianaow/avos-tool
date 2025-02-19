import React, { useState, useEffect, useCallback, useMemo } from "react";
import * as d3 from "d3";
import { Popup, Button, Dropdown } from "semantic-ui-react";
import _ from 'lodash';

import Slider from "./components/Shared/slider/Slider";
import Header from "./components/Shared/Header";
import RadarScatter from "./components/Main/RadarScatter";
import { TooltipProvider } from './components/contexts/TooltipContext';
import Legend from './components/Main/Legend';
import Table from "./components/Main/Table";
import { getPropertyName, cleanTopic, cleanCategory, onlyUnique } from "./components/utils";

// Custom hook for managing state
const useMainPageState = () => {
  const [dataAll, setData] = useState({ 
    data: [], 
    bibliography: [], 
    tooltipContent: {}, 
    journals: [] 
  });
  const [search, setSearch] = useState({ 
    value: '', 
    isLoading: false, 
    isOpen: false 
  });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    years: [],
    journals: []
  });
  const [controlsDisabled, setControlsDisabled] = useState(false);

  return {
    dataAll,
    setData,
    search,
    setSearch,
    loading,
    setLoading,
    filters,
    setFilters,
    controlsDisabled,
    setControlsDisabled
  };
};

// Custom hook for data processing
const useProcessedData = (dataAll, filters, search) => {
  return useMemo(() => {
    if (!dataAll.data?.length) return [];

    const { years, journals } = filters;
    const [minYear, maxYear] = years;
    const hasJournalFilter = journals.length > 0;
    const hasSearch = search.value !== '';

    return dataAll.data.map(d => {
      const matchesFilters = (
        d.year >= minYear && 
        d.year <= maxYear && 
        (!hasJournalFilter || journals.includes(d.sourcetitle))
      );

      const matchesSearch = hasSearch ? d.label === search.value : true;

      return {
        ...d,
        opacity: (matchesFilters && (matchesSearch || !hasSearch)) ? d.opacity : 0.1,
        interactive: (matchesFilters && (matchesSearch || !hasSearch))
      };
    });
  }, [dataAll.data, filters, search]);
};

// Year range calculation utility
const calculateYearRange = (data) => {
  if (!data?.length) return [2002, 2024];
  const years = data.map(d => d.year);
  return [Math.min(...years), Math.max(...years)];
};

const calculateSearchOptions = (data, filters) => {
  if (!data?.length) return [];
  
  const { years, journals } = filters;
  const [minYear, maxYear] = years;
  const hasJournalFilter = journals.length > 0;

  return data
    .filter(d => (
      d.year >= minYear && 
      d.year <= maxYear && 
      (!hasJournalFilter || journals.includes(d.sourcetitle))
    ))
    .map(d => d.label)
    .filter((value, index, self) => self.indexOf(value) === index)
    .map(d => ({
      key: d,
      text: d,
      value: d
    }))
    .sort((a, b) => a.text.localeCompare(b.text));
};

// Data transformation utility
const transformData = (scores, papers, bibliography, tooltipContent) => {
  const keys = ['Cons_Self', 'Cons_Soc', 'Cons_Env', 'Busi_Prof', 'Busi_Soc', 'Busi_Env', 'Inst_Gro', 'Inst_Soc', 'Inst_Env'];
  
  const data = scores.flatMap(d => 
    keys.map(key => {
      const propName = getPropertyName(d, o => o[key]);
      const [topic, category] = propName?.split('_') ?? [];
      return d[key] === 1 ? {
        unitID: d.Code,
        topic: cleanTopic(topic),
        category: cleanCategory(category),
        value: d['SP']
      } : null;
    }).filter(Boolean)
  );

  const groupedData = d3.group(data, 
    d => d.unitID,
    d => d.topic,
    d => d.category
  );

  let aggData = [];
  for (const [unitID, topics] of groupedData) {
    const paper = papers.find(el => el.Code === unitID);
    if (!paper) continue;

    for (const [topic, categories] of topics) {
      for (const [category, values] of categories) {
        const value = d3.mean(values, d => +d.value);
        aggData.push({
          entity: `${unitID}-${topic}-${category}`,
          unitID,
          topic,
          category,
          value,
          count: +paper.citationCount || 10,
          label: paper.Authors.replaceAll('|', ','),
          authors: paper.Authors.replaceAll('|', ','),
          abstract: paper.Abstract.replaceAll('|', ','),
          title: paper.Title.replaceAll('|', ','),
          url: paper.Link,
          sourcetitle: paper['Source title'],
          year: +paper.Year,
          opacity: paper.sourceFile === 'SustainabMarketing' ? 1 : 0.5
        });
      }
    }
  }

  const journalsCount = d3.rollup(aggData, v => v.length, d => d.sourcetitle);
  const topJournals = Array.from(journalsCount)
    .sort((a, b) => d3.descending(a[1], b[1]))
    .slice(0, 8)
    .map(d => d[0]);

  aggData.forEach(d => {
    d.color = topJournals.includes(d.sourcetitle) ? d.sourcetitle : 'Other journals';
  });

  aggData.sort((a, b) => d3.ascending(a.sourcetitle, b.sourcetitle))

  const counterMap = new Map(); // Store counters for each (topic, category, value) combination

  aggData.forEach(d => {
    const key = `${d.topic}-${d.category}-${d.value}`; // Unique key for tracking
  
    // Initialize counter if first occurrence
    if (!counterMap.has(key)) {
      counterMap.set(key, 1);
    }
  
    // Assign the counter and increment for the next occurrence
    d.counter = counterMap.get(key);
    counterMap.set(key, counterMap.get(key) + 1);
  });
  console.log(aggData)

  return {
    data: aggData,
    journals: [...topJournals, 'Other journals'],
    bibliography,
    tooltipContent
  };
};

const MainPage = () => {
  const {
    dataAll,
    setData,
    search,
    setSearch,
    loading,
    setLoading,
    filters,
    setFilters,
    controlsDisabled,
    setControlsDisabled
  } = useMainPageState();

  const processedData = useProcessedData(dataAll, filters, search);
  const memoizedJournals = useMemo(() => dataAll.journals, [dataAll.journals]);
  const memoizedBibliography = useMemo(() => dataAll.bibliography, [dataAll.bibliography]);
  
  // Initialize year range from data
  useEffect(() => {
    if (dataAll.data?.length && !filters.years.length) {
      const [minYear, maxYear] = calculateYearRange(dataAll.data);
      setFilters(prev => ({
        ...prev,
        years: [minYear, maxYear]
      }));
    }
  }, [dataAll.data]);

  // Handlers
  const handleYearChange = useCallback((lower, upper) => {
    setFilters(prev => ({
      ...prev,
      years: [lower, upper]
    }));
  }, []);

  const handleJournalChange = useCallback((_, { value }) => {
    setFilters(prev => ({
      ...prev,
      journals: value
    }));
  }, []);

  const handleSearchChange = useCallback(
    _.debounce((_, { value }) => {
      setSearch({
        value,
        isLoading: false,
        isOpen: false
      });

      // Reset node selection when search is cleared
      if (!value) {
        setControlsDisabled(false);
      } 
    }, 300),

    []
  );

  const handleNodeClick = useCallback((isSelected) => {
    setControlsDisabled(isSelected);
  }, []);

  // Data fetching
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${process.env.REACT_APP_API_URL}/api/data`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const result = await response.json();
        if (!result.papers || !result.scores) {
          throw new Error('Invalid data structure');
        }

        const transformedData = transformData(
          result.scores,
          result.papers,
          result.bibliography,
          result.tooltipContent
        );

        setData(transformedData);
      } catch (error) {
        console.error('Data fetch failed:', error);
        // Add proper error handling UI here
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Memoized options
  const journalOptions = useMemo(() => (
    dataAll.data
      ?.map(d => d.sourcetitle)
      .filter(onlyUnique)
      .map(d => ({
        key: d,
        text: d,
        value: d
      }))
      .sort((a, b) => d3.ascending(a.key, b.key))
  ), [dataAll.data]);

  const searchOptions = useMemo(() => {
    // Only calculate if we have data and filters
    if (!dataAll.data?.length || !filters.years.length) {
      return [];
    }
    
    return calculateSearchOptions(dataAll.data, filters);
  }, [dataAll.data, filters]);

  if (loading) {
    return (
    <>
      <Header />
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <h1>Loading...</h1>
      </div>
    </>
    )
  }

  if (!processedData.length) {
    return null;
  }

  return (
    <TooltipProvider>
      <Header />
      <div className="App__wrapper">
        <div className='App_container'>
          <div className='SideBarLeft'>
            <div className="Title">
              <h1>The A-VO-S Tool</h1>
            </div>
            <Slider 
              changeThresholds={handleYearChange}
              active={!controlsDisabled}
              range={calculateYearRange(dataAll.data)}
              value={filters.years}
            />
            <div className="Search">
              <h3>Search for a paper</h3>
              <Dropdown
                placeholder=''
                fluid
                search
                selection
                clearable
                options={searchOptions}
                onChange={handleSearchChange}
                value={search.value}
                disabled={controlsDisabled}
              />
            </div>
            <div className="Search">
              <h3 style={{margin: '10px 0px', textAlign: 'left'}}>
                Filter by Journal
              </h3>
              <Dropdown
                placeholder=''
                fluid
                multiple
                search
                selection
                options={journalOptions}
                onChange={handleJournalChange}
                value={filters.journals}
                disabled={controlsDisabled || !!search.value}
              />
            </div>
            <Table data={processedData} search={search} />
          </div>

          <div className='Main'>
            <RadarScatter
              data={processedData}
              search={search}
              journals={memoizedJournals}
              onNodeClick={handleNodeClick}
            />
            <div style={{position: 'absolute', bottom: '0px'}}>
              <div style={{display: "flex"}}>
                {dataAll.tooltipContent && 
                  Object.entries(dataAll.tooltipContent).map(([key, content]) => (
                    <Popup
                      key={key}
                      position='top center'
                      header={key}
                      trigger={<Button>{key}</Button>}
                      style={{ minWidth: '500px' }}
                    >
                      {content.map((text, i) => (
                        <p key={i}>{text}</p>
                      ))}
                    </Popup>
                  ))}
              </div>
            </div>
            <div style={{position: 'absolute', top: '10px', right: '-50px'}}>
              <Legend data={dataAll.journals} />
            </div>
          </div>
        </div>
      </div>
      {((!memoizedBibliography || memoizedBibliography.length === 0)) ? (
        <div className="footer"></div>
      ) : (
        <div className="footer">
          {memoizedBibliography?.map(text =><p>{text}</p>)}
        </div>
      )}
    </TooltipProvider>
  );
};

export default React.memo(MainPage);
