import React from 'react';

type EllipsisChildren = (nodeList: React.ReactNode[], canEllipsis: boolean) => React.ReactNode;

type EllipsisMeasureProps = {
  text?: React.ReactNode;
  children: EllipsisChildren;
};

/**
 * Safety patch for AntD Typography ellipsis measurement loops.
 * It bypasses layout-measure state updates and renders full text content.
 */
export default function SafeEllipsisMeasure(props: EllipsisMeasureProps) {
  const nodeList = Array.isArray(props.text)
    ? props.text
    : props.text === undefined || props.text === null
      ? []
      : [props.text];

  return <>{props.children(nodeList, false)}</>;
}

