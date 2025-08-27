import React from 'react';
import { parsePipeDelimitedTable } from '../utils/tableParser';

const TableDisplay = ({ ragResponse }) => {
  if (!ragResponse) return null;

  const parsedContent = parsePipeDelimitedTable(ragResponse);

  return (
    <div className="table-display">
      <h4>Parsed RAG Response:</h4>
      <div dangerouslySetInnerHTML={{ __html: parsedContent }} />
    </div>
  );
};

export default TableDisplay;
