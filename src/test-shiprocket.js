// test-shiprocket.js
const axios = require("axios");
require("dotenv").config();

async function testLogin() {
  try {
    const response = await axios.post(
      `${process.env.SHIPROCKET_BASE_URL}/auth/login`,
      {
        email: process.env.SHIPROCKET_EMAIL,
        password: process.env.SHIPROCKET_PASSWORD,
      },
    );
    console.log("✅ Login successful!");
    console.log("Token:", response.data.token);
  } catch (error) {
    console.error("❌ Login failed:");
    console.error("Status:", error.response?.status);
    console.error("Data:", error.response?.data);
  }
}

testLogin();
