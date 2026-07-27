// services/googleSheets.js
const { google } = require("googleapis");

class GoogleSheetsService {
  constructor() {
    this.spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    if (!this.spreadsheetId) {
      throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID is not defined");
    }

    // Initialize auth using service account credentials
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(
          /\\n/g,
          "\n",
        ),
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    this.sheets = google.sheets({ version: "v4", auth });
  }

  /**
   * Append a row to a sheet and return the new row number (1‑based).
   * @param {string} sheetName - Name of the sheet (tab).
   * @param {Array} values - Array of values for the new row, in column order.
   * @returns {Promise<number>} - The row number of the inserted row.
   */
  async appendRow(sheetName, values) {
    try {
      const response = await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A:A`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        resource: {
          values: [values],
        },
      });

      // The updatedRange is like "Order Sheet!A123"
      const updatedRange =
        response.data.tableRange || response.data.updates?.updatedRange;
      if (!updatedRange) {
        throw new Error("No updatedRange returned from Google Sheets");
      }

      // Extract row number from the range string (e.g., "Order Sheet!A123" -> 123)
      const match = updatedRange.match(/!A(\d+)/);
      if (!match) {
        throw new Error(
          `Could not parse row number from range: ${updatedRange}`,
        );
      }
      const rowNumber = parseInt(match[1], 10);
      return rowNumber;
    } catch (error) {
      console.error(
        `Google Sheets appendRow error for sheet "${sheetName}":`,
        error,
      );
      throw error; // caller will handle
    }
  }

  /**
   * Update an existing row in a sheet.
   * @param {string} sheetName - Name of the sheet.
   * @param {number} rowNumber - 1‑based row number to update.
   * @param {Array} values - Array of values for the row, in column order.
   * @returns {Promise<void>}
   */
  async updateRow(sheetName, rowNumber, values) {
    try {
      // Build range: e.g., "Order Sheet!A123:Z123"
      const range = `${sheetName}!A${rowNumber}:Z${rowNumber}`;
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [values],
        },
      });
    } catch (error) {
      console.error(
        `Google Sheets updateRow error for sheet "${sheetName}" row ${rowNumber}:`,
        error,
      );
      throw error;
    }
  }
}

module.exports = new GoogleSheetsService();
