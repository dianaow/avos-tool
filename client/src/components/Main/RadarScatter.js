import React, { useState, useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import _ from 'lodash';

import Chart from "../Shared/Chart";
import Board from "./Board";
import Axis from "./RadarAxis";
import Nodes from "./Nodes";

import { callAccessor } from "../utils";
import { 
  invisibleArc, 
  colorScale, 
  fillScale, 
  tagCategories, 
  topicCategories, 
  scoreCategories, 
  values, 
  nodeRadiusScale, 
  angleSlice, 
  bufferInRad 
} from "../consts";

const getCoordsAlongArc = (data, rScale) => {
  const angle = angleSlice * (topicCategories.indexOf(data.topic));

  let angleRange 
  if(data.color === 'New paper') {
    angleRange = [angle + bufferInRad, angle + angleSlice - bufferInRad];
  } else {
    angleRange = data.topic === "Consumers" 
    ? [angle + bufferInRad * (window.innerWidth < 1800 ? 1.8 : 1.15), angle + angleSlice - bufferInRad * (window.innerWidth < 1800 ? 1.8: 1.15)] 
    : [angle + bufferInRad, angle + angleSlice - bufferInRad];
  }
  const angleScale = d3.scaleLinear()
    .range(angleRange)
    .domain(data.topic === topicCategories.slice(-1) ? [5, 1] : [1, 5]);

  const line = d3.lineRadial()
    .radius((d, i) => { 
      const index = tagCategories.indexOf(d.category);
      const start = rScale.range()[index - 1] || 0;
      if(data.color === 'New paper') {
        return (
          (callAccessor(rScale, d.category, i) - 
          (callAccessor(rScale, d.category, i) - start)/2)
        );
      } else {
        return (
          (callAccessor(rScale, d.category, i) - 
          (callAccessor(rScale, d.category, i) - start)/2) + 
          (index === 2 ? -45 + data.counter : (index === 1 ? -45 + data.counter: (d.topic === "Consumers" ? -10 : 0) + data.counter))
        );
      }
    })
    .angle(d => angleScale(d.value));

  return line([data]).slice(1).slice(0, -1).split(',');
};

const computeNodePositions = (data, rScale) => {
  // Initialize positions
  data.forEach(a => {
    const coords = getCoordsAlongArc(a, rScale);
    a.x = +coords[0];
    a.y = +coords[1];
    a.size = nodeRadiusScale(a.count);
    a.radius = rScale(a.category);
  });

  const simulation = d3.forceSimulation(data)
    .force('charge', d3.forceManyBody().strength(-30))
    .force('x', d3.forceX().x(d => d.x).strength(0.9))
    .force('y', d3.forceY().y(d => d.y).strength(0.9))
    .force('collision', d3.forceCollide().radius(d => d.size * 1.1))
    .force("r", d3.forceRadial(d => d.radius, 0, 0).strength(0.1))
    .stop();

  // Run simulation synchronously
  const n = Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()));
  for (let i = 0; i < n; ++i) {
    simulation.tick();
  }

  // Extract final positions
  const positions = data.map(d => ({
    x: d.x,
    y: d.y,
    size: d.size
  }));

  simulation.stop();
  return positions;
};

const RadarScatter = React.memo(({ data, search, journals, onNodeClick }) => {
  const positionsRef = useRef(null);
  
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight
  });

  // Handle window resize with debouncing
  useEffect(() => {
    const handleResize = _.debounce(() => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight
      });
    }, 250);
    
    window.addEventListener('resize', handleResize);
    return () => {
      handleResize.cancel();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const radius = useMemo(() => 
    Math.min(dimensions.width/2, dimensions.height/2) - 60,
    [dimensions]
  );

  const customBands = useMemo(() => ([
    { category: tagCategories[0], start: 0, end: radius * 0.55 },
    { category: tagCategories[1], start: radius * 0.55, end: radius * 0.8 }, 
    { category: tagCategories[2], start: radius * 0.8, end: radius },
  ]), [radius]);

  const rScale = useMemo(() => (
    d3.scaleOrdinal()
      .domain(tagCategories)
      .range(customBands.map(band => band.end))
  ), [customBands]);

  // Memoize labels calculation
  const labels = useMemo(() => {
    const result = [];
    topicCategories.forEach((topic) => {
      scoreCategories.forEach((score) => {
        const datum = { topic, category: tagCategories[0], value: score };
        const coords = getCoordsAlongArc(datum, rScale);
        result.push({ 
          text: values[score], 
          x: +coords[0], 
          y: +coords[1] 
        });
      });
    });
    return result;
  }, [rScale]);

  // Compute node positions with memoization
  const nodePositions = useMemo(() => {
    if (!data?.length) return [];
    
    // Create a signature for the current data state
    const dataSignature = JSON.stringify({
      data: data.map(d => ({
        entity: d.entity,
        category: d.category,
        count: d.count
      })),
      width: dimensions.width,   // Add window dimensions
      height: dimensions.height  // to the signature
    });
    
    // Return cached positions if data hasn't changed
    if (positionsRef.current?.signature === dataSignature) {
      return positionsRef.current.positions;
    }
  
    // Compute new positions
    const positions = computeNodePositions(data, rScale);
    
    // Cache the results
    positionsRef.current = {
      positions,
      signature: dataSignature
    };
    
    return positions;
  }, [data, rScale]);
  
  // Process radial data
  const radialData = useMemo(() => {
    if (!data?.length || !nodePositions.length) return [];

    fillScale.domain(journals);
    colorScale.domain(journals);
    return data.map((d, i) => ({
      ...d,
      x: nodePositions[i].x,
      y: nodePositions[i].y,
      size: nodePositions[i].size,
    }));
  }, [data, nodePositions, journals]);

  // Memoize accessors
  const accessors = useMemo(() => ({
    key: d => "entity-" + d.entity,
    x: d => d.x,
    y: d => d.y,
    fill: d => d.color === 'New paper' ? 'black' : fillScale(d.color),
    stroke: d => 'none',
    size: d => d.size,
    opacity: d => d.opacity,
    strokeWidth: 1
  }), []);

  return (
    <div className="Radar">
      <Chart dimensions={dimensions}>
        <g transform={`translate(${dimensions.width/2}, ${dimensions.height/2 + 8})`}>
          <Board
            data={tagCategories}
            keyAccessor={(d, i) => 'board-' + i}
            scale={rScale}
            range
            customBands={customBands}
          />
          <Axis
            data={topicCategories} 
            keyAccessor={(d, i) => 'axis-' + i}
            radius={radius + 20}
            innerRadius={(radius/tagCategories.length) * 0.28}
          />
          {labels.map((label, i) => (
            <React.Fragment key={i}>
              <path
                className="Radar__invisible_arc"
                id={`Radar__arc_${i}`}
                d={invisibleArc(i, radius, (Math.PI * 2) / labels.length)}
                strokeOpacity={0}
                fill='none'
              />
              <text 
                className="Radar__arcText"
                fontSize='12.5px'
                textAnchor="middle"
              >
                <textPath
                  startOffset="50%"
                  xlinkHref={`#Radar__arc_${i}`}
                >
                  {label.text}
                </textPath>
              </text>
            </React.Fragment>
          ))}
          <text 
            className="Radar__centerText"
            fontSize='14px'
            textAlign='center'
            x={-20}
          >
            ACTORS
          </text>
          <Nodes
            data={radialData} 
            accessors={accessors}
            search={search}
            onNodeClick={onNodeClick}
          />
        </g>
      </Chart>
    </div>
  );
});

export default RadarScatter;