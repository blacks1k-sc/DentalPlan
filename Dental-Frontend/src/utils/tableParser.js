/**
 * Utility to parse pipe-delimited text responses from RAG service and convert to HTML tables
 */

export function parsePipeDelimitedTable(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  const lines = text.split('\n');
  let hasTableStructure = false;

  // Check if this looks like a table (contains pipes and separators)
  for (const line of lines) {
    if (line.includes('|') && (line.includes('-----') || line.includes('---'))) {
      hasTableStructure = true;
      break;
    }
  }

  if (!hasTableStructure) {
    return text; // Return original text if no table structure
  }

  // Parse the table structure
  let headers = [];
  let dataRows = [];
  let inTable = false;

  for (const line of lines) {
    const trimmedLine = line.trim();
    
    if (trimmedLine.includes('|')) {
      const columns = trimmedLine.split('|').map(col => col.trim());
      
      // Check if this is a separator line (contains dashes)
      if (trimmedLine.includes('-----') || trimmedLine.includes('---')) {
        inTable = true;
        continue;
      }
      
      if (inTable) {
        dataRows.push(columns);
      } else {
        headers = columns;
      }
    }
  }

  // Filter out empty headers
  headers = headers.filter(h => h.trim());

  // Fix column misalignment (data shifted one column to the right)
  const fixedData = fixColumnMisalignment(headers, dataRows);

  // Generate HTML table
  if (fixedData.headers.length > 0 && fixedData.dataRows.length > 0) {
    return generateHTMLTable(fixedData.headers, fixedData.dataRows);
  }

  return text; // Fallback to original text
}

/**
 * Fix column misalignment where data is shifted one column to the right
 */
function fixColumnMisalignment(headers, dataRows) {
  // Check if first column is empty in data rows (indicating misalignment)
  const hasMisalignment = dataRows.some(row => 
    row.length > 0 && (!row[0] || row[0].trim() === '')
  );

  if (hasMisalignment) {
    console.log('Table Parser - Detected column misalignment, fixing...');
    
    // Shift all data one column to the left
    const newHeaders = headers.slice(1); // Remove first empty header
    const newDataRows = dataRows.map(row => row.slice(1)); // Remove first empty column
    
    console.log('Table Parser - After fixing misalignment, headers:', newHeaders);
    console.log('Table Parser - After fixing misalignment, data rows:', newDataRows);
    
    return { headers: newHeaders, dataRows: newDataRows };
  }

  return { headers, dataRows };
}

function generateHTMLTable(headers, dataRows) {
  let html = '<div class="rag-table-container" style="overflow-x: auto; margin: 10px 0;">';
  html += '<table class="rag-table" style="width: 100%; border-collapse: collapse; border: 1px solid #ddd; font-family: Arial, sans-serif;">';
  
  // Table header
  html += '<thead><tr>';
  headers.forEach(header => {
    html += `<th style="border: 1px solid #ddd; padding: 8px; text-align: left; background-color: #f2f2f2; font-weight: bold;">${header}</th>`;
  });
  html += '</tr></thead>';
  
  // Table body
  html += '<tbody>';
  dataRows.forEach(row => {
    html += '<tr>';
    row.forEach(cell => {
      html += `<td style="border: 1px solid #ddd; padding: 8px; text-align: left;">${cell}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody>';
  
  html += '</table></div>';
  
  return html;
}

/**
 * Alternative: Convert to React components for better integration
 */
export function parseToTableData(text) {
  if (!text || typeof text !== 'string') {
    return { isTable: false, content: text };
  }

  const lines = text.split('\n');
  let hasTableStructure = false;

  // Check for table structure
  for (const line of lines) {
    if (line.includes('|') && (line.includes('-----') || line.includes('---'))) {
      hasTableStructure = true;
      break;
    }
  }

  if (!hasTableStructure) {
    return { isTable: false, content: text };
  }

  // Parse table
  let headers = [];
  let dataRows = [];
  let inTable = false;

  for (const line of lines) {
    const trimmedLine = line.trim();
    
    if (trimmedLine.includes('|')) {
      const columns = trimmedLine.split('|').map(col => col.trim());
      
      if (trimmedLine.includes('-----') || trimmedLine.includes('---')) {
        inTable = true;
        continue;
      }
      
      if (inTable) {
        dataRows.push(columns);
      } else {
        headers = columns;
      }
    }
  }

  // Filter out empty headers
  headers = headers.filter(h => h.trim());

  // Apply column misalignment fix
  const fixedData = fixColumnMisalignment(headers, dataRows);

  if (fixedData.headers.length > 0 && fixedData.dataRows.length > 0) {
    return {
      isTable: true,
      headers: fixedData.headers,
      dataRows: fixedData.dataRows,
      content: text
    };
  }

  return { isTable: false, content: text };
}
