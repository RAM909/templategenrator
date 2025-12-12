const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const Excel = require("exceljs");
const { format: csvFormat } = require("fast-csv");
const archiver = require("archiver");

// ---- helpers (same as before) ----
function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const num = Number(value);
  return isNaN(num) ? 0 : num;
}

function excelDateToDMY(excelDate) {
  if (excelDate === null || excelDate === undefined || excelDate === "") return "";
  const num = Number(excelDate);
  if (isNaN(num) || num < 1) return "";
  const jsDate = new Date((num - 25569) * 86400 * 1000);
  if (isNaN(jsDate.getTime())) return "";
  const day = String(jsDate.getDate()).padStart(2, "0");
  const month = String(jsDate.getMonth() + 1).padStart(2, "0");
  const year = jsDate.getFullYear();
  return `${day}-${month}-${year}`;
}

function convertnumbertopercentage(value) {
  if (value === null || value === undefined || value === "") return "0%";
  const num = Number(value);
  if (isNaN(num)) return "0%";
  return `${num}%`;
}

function normalizeLanNo(lanNo) {
  if (lanNo === null || lanNo === undefined || lanNo === "") return null;
  return String(lanNo).trim();
}

function formatMonth(input) {
  const [year, month] = input.split("-");
  const date = new Date(year, month - 1);
  const shortMonth = date.toLocaleString("en-US", { month: "short" });
  const shortYear = year.slice(2);
  return `${shortMonth}-${shortYear}`;
}

function getMonthAndYear(input) {
  const [year, month] = input.split("-");
  const date = new Date(year, month - 1);
  const monthLower = date.toLocaleString("en-US", { month: "long" }).toLowerCase();
  return { month: monthLower, year: year };
}

function getNextMonthDate(input, day) {
  const [year, month] = input.split("-").map(Number);
  const date = new Date(year, month, day);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function collectAllLanNosFromDeals(dealArray) {
  const set = new Set();
  for (const deal of dealArray || []) {
    (deal.lanNos || []).forEach((lan) => {
      const n = normalizeLanNo(lan);
      if (n) set.add(n);
    });
  }
  return set;
}

const STANDARD_HEADERS = [
  "Deal Name",
  "lanNo",
  "Customer ID",
  "Collection Month",
  "Current Payout Date",
  "Bank ROI",
  "Customer ROI",
  "Opening Principal",
  "Opening Principal Overdue",
  "Opening Interest Overdue",
  "Opening Overdue",
  "Customer Billing",
  "Billing Principal",
  "Billing Interest",
  "Billing Prepayment",
  "Charges",
  "Overdue Interest",
  "Overdue Principal",
  "Current Interest",
  "Current Principal",
  "Prepayment",
  "Current Charges",
  "Other Principal Paid (Assignee)",
  "Other Interest Paid (Assignee)",
  "Customer Collections",
  "Closing Principal",
  "Input Closing Interest Overdue",
  "Input Closing Principal Overdue",
  "Input Closing Overdue",
  "Principal Share Paid To Assignee",
  "Interest Share Paid To Assignee",
  "Charge Share Paid To Assignee",
  "DPD Days",
  "Legal Action taken by the company",
  "Status",
];

// ---- deal mapping from Excel ----
function readDealMappingExcel(mappingPath, collectionMonth, payoutday) {
  if (!mappingPath) return [];

  const workbook = XLSX.readFile(mappingPath);
  const firstSheetName = workbook.SheetNames[0];
  const ws = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

  const dealMap = {};

  rows.forEach((row) => {
    let lanKey = null;
    let dealKey = null;
    Object.keys(row).forEach((k) => {
      const lower = k.toLowerCase().trim();
      if (!lanKey && (lower === "lanno" || lower === "lan" || lower.includes("loan"))) {
        lanKey = k;
      }
      if (!dealKey && (lower === "dealname" || lower.includes("deal"))) {
        dealKey = k;
      }
    });

    if (!lanKey || !dealKey) return;
    const lanNo = normalizeLanNo(row[lanKey]);
    const dealName = String(row[dealKey] || "").trim();
    if (!lanNo || !dealName) return;

    if (!dealMap[dealName]) {
      dealMap[dealName] = { dealName, lanNos: [] };
    }
    dealMap[dealName].lanNos.push(lanNo);
  });

  const dealArray = Object.values(dealMap).map((deal) => ({
    dealName: deal.dealName,
    lanNos: deal.lanNos,
    collectionMonth,
    payoutday,
  }));

  console.log("daealArray", dealArray);

  return dealArray;
}

// ---- loan report (exceljs streaming) ----
const PREFERRED_SHEET_ORDER = [
  "Closing Loan Dump",
  "Opening Loan Dump",
  "EMI",
  "Ope Due LIst",
  "Effective closure date",
  "Early Closure",
  "Part-Payment",
];

async function processExcelFileStream(filePath, sheetType, lanNos, month, year, progressCallback) {
  // Helper function to find column with flexible month matching
  const findMonthColumn = (row, monthName, suffix, year) => {
    const monthVariations = [
      monthName.toLowerCase(),
      monthName.charAt(0).toUpperCase() + monthName.slice(1).toLowerCase(),
      monthName.toUpperCase(),
      monthName.substring(0, 3).toLowerCase(),
      monthName.substring(0, 3).charAt(0).toUpperCase() + monthName.substring(0, 3).slice(1).toLowerCase(),
      monthName.substring(0, 3).toUpperCase()
    ];
    
    for (const key of Object.keys(row)) {
      const keyLower = key.toLowerCase();
      for (const variation of monthVariations) {
        const pattern1 = `${variation}_${suffix}_${year}`.toLowerCase();
        const pattern2 = `${variation.substring(0, 3)}_${suffix}_${year}`.toLowerCase();
        if (keyLower === pattern1 || keyLower === pattern2) {
          return key;
        }
      }
    }
    return null;
  };

  const SHEET_CONFIG = {
    "Closing Loan Dump": {
      keyColumn: "Loan Number",
      mappings: {
        "DPD": "DPD Days",
        "Total POS": "Closing Principal",
        "Overdue POS": "Input Closing Principal Overdue",
        "Overdue Interest": "Input Closing Interest Overdue",
      },
      computed: [
        {
          outputHeader: "Input Closing Overdue",
          compute: (row) =>
            toNumber(row["Overdue POS"]) + toNumber(row["Overdue Interest"]),
        },
      ],
    },
    "Opening Loan Dump": {
      keyColumn: "Loan Number",
      mappings: {
        "Total POS": "Opening Principal",
        "Overdue POS": "Opening Principal Overdue",
        "Overdue Interest": "Opening Interest Overdue",
      },
      computed: [
        {
          outputHeader: "Opening Overdue",
          compute: (row) =>
            toNumber(row["Overdue POS"]) + toNumber(row["Overdue Interest"]),
        },
      ],
    },
    "EMI": {
      keyColumn: "loan_no",
      mappings: {},
      dynamicMappings: (row) => {
        const principalCol = findMonthColumn(row, month, "Principal", year) || findMonthColumn(row, month, "principal", year);
        const interestCol = findMonthColumn(row, month, "Int", year) || findMonthColumn(row, month, "int", year) || findMonthColumn(row, month, "Interest", year) || findMonthColumn(row, month, "interest", year);
        
        const mappings = {};
        if (principalCol) mappings[principalCol] = "Billing Principal";
        if (interestCol) mappings[interestCol] = "Billing Interest";
        return mappings;
      },
      computed: [
        {
          outputHeader: "Customer Billing",
          compute: (row) => {
            const principalCol = findMonthColumn(row, month, "Principal", year) || findMonthColumn(row, month, "principal", year);
            const interestCol = findMonthColumn(row, month, "Int", year) || findMonthColumn(row, month, "int", year) || findMonthColumn(row, month, "Interest", year) || findMonthColumn(row, month, "interest", year);
            return toNumber(row[principalCol]) + toNumber(row[interestCol]);
          },
        },
      ],
    },
    "Ope Due LIst": {
      keyColumn: "LOAN_NO",
      computed: [
        {
          outputHeader: "Current Payout Date",
          compute: (row) =>
            excelDateToDMY(row["CURRENT_MONTH_INSTLAMENT_DUE_DATE"]),
        },
        {
          outputHeader: "Customer ROI",
          compute: (row) => convertnumbertopercentage(row["LOAN EFF RATE"]),
        },
      ],
    },
    "Part-Payment": {
      keyColumn: "LOAN NO",
      mappings: {
        "PREPAYMENT AMOUNT": "Billing Prepayment",
      },
      computed: [
        {
          outputHeader: "Current Payout Date",
          compute: (row) => excelDateToDMY(row["Early Closure Date"]),
        },
      ],
    },
    "Effective closure date": {
      keyColumn: "Loan Number",
      computed: [
        {
          outputHeader: "Current Payout Date",
          compute: (row) => excelDateToDMY(row["Early Closure Date"]),
        },
      ],
    },
    "Early Closure": {
      keyColumn: "Loan Number",
      computed: [
        {
          outputHeader: "Current Payout Date",
          compute: (row) => excelDateToDMY(row["Author Date"]),
        },
      ],
    },
  };

  const dataByLanNo = {};
  const normalizedLanNos = lanNos.map(normalizeLanNo).filter(Boolean);

  const workbookReader = new Excel.stream.xlsx.WorkbookReader(filePath);
  const config = SHEET_CONFIG[sheetType];
  
  if (!config) {
    progressCallback?.({ type: "log", message: `Unknown sheet type: ${sheetType}, skipping file` });
    return dataByLanNo;
  }

  let sheetIndex = 0;
  for await (const worksheetReader of workbookReader) {
    // Always process only the first sheet (index 0)
    if (sheetIndex > 0) break;
    sheetIndex++;
    
    const actualSheetName = (worksheetReader.name || "").trim();
    progressCallback?.({ type: "log", message: `Processing "${actualSheetName}" as "${sheetType}"` });

    let header = null;

    for await (const row of worksheetReader) {
      const valuesRaw = row.values || [];
      const values = valuesRaw.slice(1);

      if (!header) {
        header = values.map((h) =>
          h === null || h === undefined ? "" : String(h).trim()
        );
        continue;
      }

      const rowObj = {};
      for (let i = 0; i < header.length; i++) {
        const key = header[i];
        if (!key) continue;
        rowObj[key] = values[i];
      }

      const rawLanNo = rowObj[config.keyColumn.trim()];
      const normalizedLanNo = normalizeLanNo(rawLanNo);
      if (!normalizedLanNo || !normalizedLanNos.includes(normalizedLanNo)) {
        continue;
      }

      if (!dataByLanNo[normalizedLanNo]) {
        dataByLanNo[normalizedLanNo] = {};
      }

      // Handle dynamic mappings (for EMI sheet with flexible month names)
      const mappingsToUse = typeof config.dynamicMappings === 'function' 
        ? config.dynamicMappings(rowObj) 
        : (config.mappings || {});

      Object.entries(mappingsToUse).forEach(
        ([sheetHeader, outputHeader]) => {
          const key = sheetHeader.trim();
          if (
            rowObj[key] !== undefined &&
            rowObj[key] !== null &&
            rowObj[key] !== ""
          ) {
            dataByLanNo[normalizedLanNo][outputHeader] = rowObj[key] || 0;
          } else {
            if (!(outputHeader in dataByLanNo[normalizedLanNo])) {
              dataByLanNo[normalizedLanNo][outputHeader] = 0;
            }
          }
        }
      );

      if (Array.isArray(config.computed)) {
        config.computed.forEach((rule) => {
          const value = rule.compute(rowObj);
          if (value !== undefined && value !== null && value !== "") {
            dataByLanNo[normalizedLanNo][rule.outputHeader] = value || 0;
          } else {
            if (!(rule.outputHeader in dataByLanNo[normalizedLanNo])) {
              dataByLanNo[normalizedLanNo][rule.outputHeader] = 0;
            }
          }
        });
      }
    }
  }

  return dataByLanNo;
}

async function processDealToCsvFile(fileSheetMappings, dealInfo, csvStream, progressCallback, dealProgress) {
  const { dealName, lanNos, collectionMonth, payoutday } = dealInfo;

  const dataByLanNo = {};
  const formattedMonth = formatMonth(collectionMonth);
  const { month, year } = getMonthAndYear(collectionMonth);
  const payoutDate = getNextMonthDate(collectionMonth, payoutday);

  lanNos.forEach((lanNo) => {
    const norm = normalizeLanNo(lanNo);
    if (!norm) return;
    dataByLanNo[norm] = {
      "Deal Name": dealName,
      "lanNo": norm,
      "Customer ID": norm,
      "Collection Month": formattedMonth,
      "Current Payout Date": payoutDate,
      "Bank ROI": "0%",
      "Customer ROI": "0%",
      "Opening Principal": 0,
      "Opening Principal Overdue": 0,
      "Opening Interest Overdue": 0,
      "Opening Overdue": 0,
      "Customer Billing": 0,
      "Billing Principal": 0,
      "Billing Interest": 0,
      "Billing Prepayment": 0,
      "Charges": 0,
      "Overdue Interest": 0,
      "Overdue Principal": 0,
      "Current Interest": 0,
      "Current Principal": 0,
      "Prepayment": 0,
      "Current Charges": 0,
      "Other Principal Paid (Assignee)": 0,
      "Other Interest Paid (Assignee)": 0,
      "Customer Collections": 0,
      "Closing Principal": 0,
      "Input Closing Interest Overdue": 0,
      "Input Closing Principal Overdue": 0,
      "Input Closing Overdue": 0,
      "Principal Share Paid To Assignee": 0,
      "Interest Share Paid To Assignee": 0,
      "Charge Share Paid To Assignee": 0,
      "DPD Days": 0,
      "Legal Action taken by the company": "",
      "Status": "Active",
    };
  });

  progressCallback?.({
    type: "log",
    message: `Processing deal: ${dealName} (${lanNos.length} LANs)`
  });

  // Sort files by preferred sheet order
  const sortedMappings = [...fileSheetMappings].sort((a, b) => {
    const indexA = PREFERRED_SHEET_ORDER.indexOf(a.sheetType);
    const indexB = PREFERRED_SHEET_ORDER.indexOf(b.sheetType);
    return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
  });

  const totalFiles = sortedMappings.length;
  for (let i = 0; i < sortedMappings.length; i++) {
    const mapping = sortedMappings[i];
    
    // Calculate progress within this deal
    const fileProgressStart = dealProgress.start + (dealProgress.range * i / totalFiles);
    const fileProgressEnd = dealProgress.start + (dealProgress.range * (i + 1) / totalFiles);
    
    progressCallback?.({
      type: "progress",
      value: Math.round(fileProgressStart),
      status: `Processing ${dealName}: ${mapping.sheetType}`
    });
    
    progressCallback?.({
      type: "log",
      message: `  Processing: ${path.basename(mapping.filePath)} [${mapping.sheetType}]`
    });
    
    const partial = await processExcelFileStream(
      mapping.filePath, 
      mapping.sheetType, 
      lanNos, 
      month, 
      year, 
      progressCallback
    );
    Object.entries(partial).forEach(([ln, data]) => {
      if (!dataByLanNo[ln]) return;
      Object.assign(dataByLanNo[ln], data);
    });
    
    progressCallback?.({
      type: "progress",
      value: Math.round(fileProgressEnd),
      status: `Completed ${mapping.sheetType} for ${dealName}`
    });
  }

  Object.values(dataByLanNo).forEach((row) => {
    row["Customer Collections"] =
      toNumber(row["Opening Principal Overdue"]) +
      toNumber(row["Opening Interest Overdue"]) +
      toNumber(row["Billing Principal"]) +
      toNumber(row["Billing Interest"]) -
      toNumber(row["Input Closing Principal Overdue"]) -
      toNumber(row["Input Closing Interest Overdue"]) +
      toNumber(row["Billing Prepayment"]);
    
    // Dynamic status logic
    const openingPrincipal = toNumber(row["Opening Principal"]);
    const prepayment = toNumber(row["Prepayment"]);
    const customerCollections = toNumber(row["Customer Collections"]);
    const closingPrincipal = toNumber(row["Closing Principal"]);

    // Check for Prepayment status: Opening Principal = Prepayment + Customer Collections AND Closing Principal = 0
    if (closingPrincipal === 0 && openingPrincipal === (prepayment + customerCollections)) {
      row["Status"] = "Prepayment";
    }
    // Check for Written-off status: Customer Collections < Opening Principal AND Closing Principal = 0
    else if (closingPrincipal === 0 && customerCollections < openingPrincipal) {
      row["Status"] = "Written-off";
    }
    // Otherwise keep the existing status (Active or whatever was set)

    const csvRow = {};
    STANDARD_HEADERS.forEach((h) => {
      csvRow[h] = row[h] ?? "";
    });
    csvStream.write(csvRow);
  });
}

async function buildLoanCsvToFile(fileSheetMappings, dealArray, outPath, progressCallback) {
  if (!fileSheetMappings.length || !dealArray.length) return null;

  progressCallback?.({ 
    type: "log", 
    message: "Generating loan_report.csv ..." 
  });
  progressCallback?.({ 
    type: "progress", 
    value: 10, 
    status: "Starting loan report generation" 
  });

  const writeStream = fs.createWriteStream(outPath);
  const csvStream = csvFormat({ headers: STANDARD_HEADERS });
  csvStream.pipe(writeStream);

  // Progress: 10% to 70% for loan processing (60% total)
  const totalDeals = dealArray.length;
  const progressPerDeal = 60 / totalDeals;
  
  for (let i = 0; i < dealArray.length; i++) {
    const deal = dealArray[i];
    const dealProgressStart = 10 + (i * progressPerDeal);
    const dealProgressRange = progressPerDeal;
    
    await processDealToCsvFile(
      fileSheetMappings, 
      deal, 
      csvStream, 
      progressCallback,
      { start: dealProgressStart, range: dealProgressRange }
    );
  }

  csvStream.end();

  return new Promise((resolve, reject) => {
    writeStream.on("finish", () => {
      progressCallback?.({
        type: "log",
        message: `Loan report written to: ${outPath}`
      });
      resolve(outPath);
    });
    writeStream.on("error", reject);
  });
}

// ---- billing units ----
function parseHeaderWithUnderscores(header) {
  if (!header || typeof header !== "string") return null;
  const parts = header.trim().split("_");
  if (parts.length !== 3) return null;

  const [monthName, billingType, year] = parts;
  const monthMap = {
    january: "Jan", jan: "Jan",
    february: "Feb", feb: "Feb",
    march: "Mar", mar: "Mar",
    april: "Apr", apr: "Apr",
    may: "May",
    june: "Jun", jun: "Jun",
    july: "Jul", jul: "Jul",
    august: "Aug", aug: "Aug",
    september: "Sep", sep: "Sep",
    october: "Oct", oct: "Oct",
    november: "Nov", nov: "Nov",
    december: "Dec", dec: "Dec",
  };
  const shortMonth = monthMap[monthName.toLowerCase()];
  if (!shortMonth) return null;

  let type;
  const lower = billingType.toLowerCase();
  if (lower.includes("principal")) type = "Principal Billing";
  else if (lower.includes("int") || lower.includes("interest"))
    type = "Interest Billing";
  else return null;

  return {
    monthYear: `${shortMonth}-${year}`,
    type,
  };
}

function groupColumnsByMonth(headers) {
  const monthGroups = {};
  headers.forEach((header, idx) => {
    if (!header) return;
    const parsed = parseHeaderWithUnderscores(String(header));
    if (!parsed) return;
    if (!monthGroups[parsed.monthYear]) monthGroups[parsed.monthYear] = {};
    monthGroups[parsed.monthYear][parsed.type] = idx;
  });
  return monthGroups;
}

async function buildBillingUnitsCsvToFile(billingPath, allowedLanNosSet, outPath, progressCallback) {
  if (!billingPath) return null;

  progressCallback?.({ type: "log", message: "Generating billing_units.csv ..." });

  const writeStream = fs.createWriteStream(outPath);
  const csvStream = csvFormat({
    headers: ["Customer", "Month", "PrincipalBilling", "InterestBilling"],
  });
  csvStream.pipe(writeStream);

  const workbookReader = new Excel.stream.xlsx.WorkbookReader(billingPath);

  for await (const worksheetReader of workbookReader) {
    let header = null;
    let monthGroups = {};
    let customerColIndex = 0;

    for await (const row of worksheetReader) {
      const valuesRaw = row.values || [];
      const values = valuesRaw.slice(1);

      if (!header) {
        header = values.map((h) =>
          h === null || h === undefined ? "" : String(h).trim()
        );

        customerColIndex = 0;
        header.forEach((h, idx) => {
          const lower = h.toLowerCase();
          if (
            lower.includes("customer") ||
            lower.includes("lan") ||
            lower.includes("loan")
          ) {
            customerColIndex = idx;
          }
        });

        monthGroups = groupColumnsByMonth(header);
        continue;
      }

      const customerRaw = values[customerColIndex];
      const normLan = normalizeLanNo(customerRaw);
      if (!normLan) continue;

      if (allowedLanNosSet && allowedLanNosSet.size > 0 && !allowedLanNosSet.has(normLan)) {
        continue;
      }

      const months = Object.keys(monthGroups);
      if (months.length === 0) continue;

      months.forEach((month) => {
        const principalIdx = monthGroups[month]["Principal Billing"];
        const interestIdx = monthGroups[month]["Interest Billing"];

        const principalVal =
          principalIdx != null ? Number(values[principalIdx] || 0) : 0;
        const interestVal =
          interestIdx != null ? Number(values[interestIdx] || 0) : 0;

        if ((principalVal || 0) === 0 && (interestVal || 0) === 0) {
          return;
        }

        csvStream.write({
          Customer: normLan,
          Month: month,
          PrincipalBilling: principalVal,
          InterestBilling: interestVal,
        });
      });
    }
  }

  csvStream.end();

  return new Promise((resolve, reject) => {
    writeStream.on("finish", () => {
      progressCallback?.({
        type: "log",
        message: `Billing units report written to: ${outPath}`
      });
      resolve(outPath);
    });
    writeStream.on("error", reject);
  });
}

// ---- main orchestration ----
async function runTransform(config, progressCallback) {
  const { mappingPath, loanFilePaths, billingPath, collectionMonth, payoutday, outputDir } =
    config;

  if (!loanFilePaths.length && !billingPath) {
    throw new Error("No loan files and no billing file provided.");
  }

  progressCallback?.({ type: "progress", value: 2, status: "Initializing..." });

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  progressCallback?.({ type: "progress", value: 5, status: "Reading configuration..." });

  let dealArray = [];
  if (mappingPath && collectionMonth && payoutday) {
    progressCallback?.({ type: "log", message: "Reading deal mapping file..." });
    dealArray = readDealMappingExcel(mappingPath, collectionMonth, payoutday);
    progressCallback?.({ 
      type: "progress", 
      value: 8, 
      status: `Loaded ${dealArray.length} deal(s)` 
      
    });
  }

  let loanCsvPath = null;
  let billingCsvPath = null;

  if (loanFilePaths.length && dealArray.length) {
    const outLoan = path.join(outputDir, `${collectionMonth.replace("-", "_")}_loan_report.csv`);
    loanCsvPath = await buildLoanCsvToFile(loanFilePaths, dealArray, outLoan, progressCallback);
    progressCallback?.({ 
      type: "progress", 
      value: 70, 
      status: "Loan report completed" 
    });
  }

  const lanNosSet =
    dealArray && dealArray.length ? collectAllLanNosFromDeals(dealArray) : new Set();

  if (billingPath) {
    progressCallback?.({ 
      type: "progress", 
      value: 75, 
      status: "Processing billing units..." 
    });
    const outBilling = path.join(outputDir, `${collectionMonth.replace("-", "_")}_billing_units.csv`);
    billingCsvPath = await buildBillingUnitsCsvToFile(
      billingPath,
      lanNosSet,
      outBilling,
      progressCallback
    );
    progressCallback?.({ 
      type: "progress", 
      value: 85, 
      status: "Billing units completed" 
    });
  }

  if (loanCsvPath && billingCsvPath) {
    progressCallback?.({ 
      type: "progress", 
      value: 90, 
      status: "Creating ZIP archive..." 
    });
    const zipPath = path.join(outputDir, `${collectionMonth.replace("-", "_")}_final_report.zip`);
    progressCallback?.({ type: "log", message: `Creating ${collectionMonth.replace("-", "_")}_final_report.zip ...` });

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      output.on("close", () => {
        progressCallback?.({
          type: "log",
          message: `ZIP created at: ${zipPath}`
        });
        resolve();
      });

      archive.on("error", reject);
      archive.pipe(output);
      archive.file(loanCsvPath, { name: `${collectionMonth.replace("-", "_")}_loan_report.csv` });
      archive.file(billingCsvPath, { name: `${collectionMonth.replace("-", "_")}_billing_units.csv` });
      archive.finalize();
    });
    
    progressCallback?.({ 
      type: "progress", 
      value: 95, 
      status: "ZIP archive created" 
    });
  }

  progressCallback?.({ type: "log", message: "Done ✅" });
  progressCallback?.({ type: "progress", value: 100, status: "Processing complete!" });
}

module.exports = { runTransform };
