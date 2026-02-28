require("dotenv").config();

module.exports = {
  mongodb: {
    url: process.env.MONGO_URI,
    databaseName: "zenkai",
  },

  migrationsDir: "migrations",
  changelogCollectionName: "changelog",

  migrationFileExtension: ".js",

  useFileHash: false,
  moduleSystem: "commonjs",
};
