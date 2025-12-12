# Sheet Type Selection Implementation

## Overview
Implemented a dropdown-based sheet type selection system for loan files, allowing users to specify which sheet type each Excel file represents, regardless of the actual sheet names in the files.

## Key Changes

### 1. **UI Updates (index.html)**
- Added dropdown selector for each of the 7 loan file slots
- Dropdown options match `PREFERRED_SHEET_ORDER`:
  - Closing Loan Dump
  - Opening Loan Dump
  - EMI
  - Ope Due List
  - Effective Closure Date
  - Early Closure
  - Part-Payment

### 2. **Frontend Logic (renderer.js)**
- Added `loanSheetTypes` array to track sheet type for each file
- Updated file selection to require sheet type selection before browsing
- Modified payload to send array of `{filePath, sheetType}` objects
- Updated removal and visibility functions to handle sheet types

### 3. **Processing Logic (processing.js)**
- Added `PREFERRED_SHEET_ORDER` constant for processing order
- Updated `processExcelFileStream()` to:
  - Accept `sheetType` parameter instead of reading sheet names
  - Always read sheet at index 0 (first sheet)
  - Use provided `sheetType` to determine configuration
- Modified `processDealToCsvFile()` to:
  - Accept `fileSheetMappings` array
  - Sort files by `PREFERRED_SHEET_ORDER` before processing
- Updated all related functions to use the new mapping structure

### 4. **Main Process (main.js)**
- Updated IPC handler to pass through new payload structure
- Added comments explaining the new format

## How It Works

### User Workflow
1. User selects sheet type from dropdown for File 1
2. User clicks Browse to select Excel file
3. System stores both file path and sheet type
4. User can add up to 7 files, each with its own sheet type
5. On processing, files are sorted by `PREFERRED_SHEET_ORDER` and processed sequentially

### Processing Flow
```
1. User uploads files with sheet types
   ↓
2. Frontend creates array: [{filePath, sheetType}, ...]
   ↓
3. Backend receives file-sheet mappings
   ↓
4. Files sorted by PREFERRED_SHEET_ORDER
   ↓
5. Each file's first sheet (index 0) read as specified sheet type
   ↓
6. Data merged according to sheet type configuration
   ↓
7. Output generated
```

## Benefits
✅ **Sheet name agnostic** - Works regardless of actual sheet names in Excel files
✅ **Explicit mapping** - User explicitly declares what each file contains
✅ **Predictable order** - Files always processed in consistent order
✅ **Simplified logic** - No complex sheet detection needed
✅ **Better UX** - Clear selection process with validation

## Validation
- User must select sheet type before selecting file
- Only first sheet (index 0) is read from each file
- Files without sheet type selection are ignored
- Empty/null entries automatically filtered out

## File Structure
Each loan file object now contains:
```javascript
{
  filePath: "C:\\path\\to\\file.xlsx",
  sheetType: "Closing Loan Dump"
}
```

## Processing Order (Enforced)
1. Closing Loan Dump
2. Opening Loan Dump
3. EMI
4. Ope Due List
5. Effective Closure Date
6. Early Closure
7. Part-Payment
