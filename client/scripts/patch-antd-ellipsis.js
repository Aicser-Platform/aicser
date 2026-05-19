/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function writeIfExists(filePath, content) {
  if (!fs.existsSync(filePath)) {
    console.log(`[patch-antd-ellipsis] skip (missing): ${filePath}`);
    return;
  }
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[patch-antd-ellipsis] patched: ${filePath}`);
}

function main() {
  const root = process.cwd();
  const esPath = path.join(root, 'node_modules', 'antd', 'es', 'typography', 'Base', 'Ellipsis.js');
  const libPath = path.join(root, 'node_modules', 'antd', 'lib', 'typography', 'Base', 'Ellipsis.js');

  const esContent = `"use client";
import * as React from 'react';
export default function EllipsisMeasure(props) {
  const nodeList = Array.isArray(props?.text)
    ? props.text
    : props?.text === undefined || props?.text === null
      ? []
      : [props.text];
  return /*#__PURE__*/React.createElement(React.Fragment, null, props.children(nodeList, false));
}
`;

  const libContent = `"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = EllipsisMeasure;
var React = require("react");
function EllipsisMeasure(props) {
  var nodeList = Array.isArray(props && props.text)
    ? props.text
    : (props && props.text) === undefined || (props && props.text) === null
      ? []
      : [props.text];
  return React.createElement(React.Fragment, null, props.children(nodeList, false));
}
`;

  writeIfExists(esPath, esContent);
  writeIfExists(libPath, libContent);
}

main();

