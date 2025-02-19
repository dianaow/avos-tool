import React, { createContext, useState } from "react"

export const initialTooltipState = {
  show: false,
  info: {}
}

export const TooltipContext = createContext(initialTooltipState)

export function TooltipProvider(props) {

  const [tooltipState, setTooltip] = useState(initialTooltipState)
  console.log('TooltipProvider state:', tooltipState);
  
  return(
    <TooltipContext.Provider value={{ tooltipState, setTooltip }}>
      { props.children }
    </TooltipContext.Provider>
  )

}