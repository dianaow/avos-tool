import React, { useContext } from "react";
import PropTypes from "prop-types"
import { values } from "../consts"
import { TooltipContext } from '../contexts/TooltipContext';

const Tooltip = ({...props }) => {
  const { tooltipState } = useContext(TooltipContext)

  const { show, info } = tooltipState
  //console.log('Tooltip state:', tooltipState);

  function relabelCategory(d) {
    if(d.category === "Self-Profit-Growth") {
      if(d.topic === 'Institutions') {
        return 'Growth'
      } else if(d.topic === 'Businesses') {
        return 'Profit'
      } else if(d.topic === 'Consumers') {
        return 'Self'
      } 
    } else {
      return d.category
    }
  }

  return (
    <g className="Tooltip" style={{ visibility: show ? 'visible' : 'hidden' }}>
      <circle
        className="Tooltip__circle"
        r={60}
        fill='#f5f5f5'  
        fillOpacity={0.9}
      />  
      <text {...props}
        className="Tooltip__unit"
        y={-20}  
      >
        { "Paper: " + info.label }
      </text>
      <text {...props}
        className="Tooltip__entity"
        y={0}  
      >
        { "Topic: " + info.topic }
      </text> 
      <text {...props}
        className="Tooltip__category"
        y={20}  
      >
        { "Value Orientation: " + relabelCategory(info) }
      </text> 
      <text {...props}
        className="Tooltip__score"
        y={40}  
      >
        { "Scope of Sustainability: " + values[info.value] || info.value }
      </text>  
    </g>
  )
}

Tooltip.defaultProps = {
  textAnchor: 'middle',
  fontSize: '16px',
  fill: 'black'
}

export default Tooltip
