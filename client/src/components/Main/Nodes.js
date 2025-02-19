import React, { useEffect, useContext, useRef, useCallback, useMemo } from "react";
import * as d3 from "d3";
import _ from 'lodash';
import { callAccessor } from "../utils";
import Tooltip from "./Tooltip";
import { TooltipContext, initialTooltipState } from '../contexts/TooltipContext';

const Nodes = React.memo(({ data, accessors, search, onNodeClick }) => {
  const { setTooltip } = useContext(TooltipContext);
  const nodesRef = useRef(null);
  const selectedNodeRef = useRef(null);
  const nodesSelectionRef = useRef(null);

  const showTooltip = useCallback((d) => {
    setTooltip({
      show: true,
      info: d,
    });
  }, [setTooltip]);

  const hideTooltip = useCallback(() => {
    setTooltip(initialTooltipState);
  }, [setTooltip]);

  const updateNodeOpacity = useCallback((selector, opacityValue) => {
    if (!nodesSelectionRef.current) return;
    
    const selection = typeof selector === 'string' 
      ? nodesSelectionRef.current.selectAll(selector)
      : nodesSelectionRef.current.selectAll('circle');
      
    selection.attr('opacity', typeof opacityValue === 'function' 
      ? (d) => opacityValue(d)
      : opacityValue
    );
  }, []);

  const highlightRelatedNodes = useCallback((d) => {
    updateNodeOpacity(null, 0.1);
    if (search.value) {
      // If searching, only highlight the searched node
      updateNodeOpacity(`.entity-${d.entity}`, 1);
    } else {
      // Otherwise highlight all related nodes
      const relatedNodes = data.filter(item => item.unitID === d.unitID);
      relatedNodes.forEach(node => {
        updateNodeOpacity(`.entity-${node.entity}`, 1);
      });
    }
  }, [data, updateNodeOpacity, search.value]);

  const eventHandlers = useMemo(() => ({
    handleNodeClick: (event, d) => {
      // Only allow interaction with nodes that are marked as interactive
      if (!d.interactive) return;
      
      const wasSelected = selectedNodeRef.current === d.entity;
      selectedNodeRef.current = wasSelected ? null : d.entity;

      // Notify parent component about selection state
      onNodeClick?.(!wasSelected);

      if (!wasSelected) {
        highlightRelatedNodes(d);
        showTooltip(d);
      } else {
        updateNodeOpacity(null, (d) => callAccessor(accessors.opacity, d));
        hideTooltip();
      }

      event.stopPropagation();
    },

    handleMouseOver: _.debounce((event, d) => {
      // Only allow interaction with nodes that are marked as interactive
      if (!d.interactive) return;
      
      // If a node is selected, only show tooltip for selected node
      if (selectedNodeRef.current && d.entity !== selectedNodeRef.current) return;
      
      highlightRelatedNodes(d);
      showTooltip(d);
    }, 50),

    handleMouseOut: _.debounce(() => {
      // Don't reset highlight if we have a selected node
      if (selectedNodeRef.current) return;

      updateNodeOpacity(null, (d) => callAccessor(accessors.opacity, d));
      hideTooltip();
    }, 50)
  }), [
    accessors.opacity, 
    highlightRelatedNodes, 
    updateNodeOpacity,
    showTooltip,
    hideTooltip,
    onNodeClick
  ]);

  useEffect(() => {
    if (!data?.length || !nodesRef.current) return;

    const svg = d3.select(nodesRef.current);
    nodesSelectionRef.current = svg;
    
    // Clear previous nodes
    svg.selectAll('*').remove();

    // Create nodes with D3 enter/update/exit pattern
    const nodes = svg
      .selectAll("circle")
      .data(data, d => d.entity)
      .join('circle')
      .attr('class', d => `entity-${d.entity}`)
      .attr('cx', (d, i) => callAccessor(accessors.x, d, i))
      .attr('cy', (d, i) => callAccessor(accessors.y, d, i))
      .attr('r', (d, i) => callAccessor(accessors.size, d, i))
      .attr('fill', (d, i) => callAccessor(accessors.fill, d, i))
      .attr('stroke', (d, i) => callAccessor(accessors.stroke, d, i))
      .attr('opacity', (d, i) => callAccessor(accessors.opacity, d, i))
      .attr('stroke-width', accessors.strokeWidth)
      .style('cursor', d => d.interactive ? 'pointer' : 'default');

    // Add event listeners
    nodes
      .on('click', eventHandlers.handleNodeClick)
      .on('mouseover', eventHandlers.handleMouseOver)
      .on('mouseout', eventHandlers.handleMouseOut);

    return () => {
      selectedNodeRef.current = null;
      nodesSelectionRef.current = null;
      eventHandlers.handleMouseOver.cancel();
      eventHandlers.handleMouseOut.cancel();
    };
  }, [data, accessors, eventHandlers]);

  return (
    <g className="Radar__Elements">
      <g className="Nodes" ref={nodesRef} />
      <Tooltip/>
    </g>
  );
});

export default Nodes;