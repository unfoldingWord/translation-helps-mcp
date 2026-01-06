import fetch from "node-fetch";

const SERVER_URL = "http://localhost:8177/api/mcp";

async function testMCPEndpoint() {
  console.log("🧪 Testing MCP Endpoint at", SERVER_URL, "\n");

  // Test 1: OPTIONS (CORS preflight)
  console.log("1️⃣ Testing OPTIONS (CORS preflight)...");
  try {
    const optionsResponse = await fetch(SERVER_URL, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:6274",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type, Authorization",
      },
    });

    console.log(`   Status: ${optionsResponse.status}`);
    const corsHeaders = {};
    optionsResponse.headers.forEach((value, name) => {
      if (name.toLowerCase().startsWith("access-control")) {
        corsHeaders[name] = value;
      }
    });
    console.log("   CORS Headers:", corsHeaders);

    if (optionsResponse.status === 200) {
      console.log("   ✅ OPTIONS request successful!\n");
    } else {
      const text = await optionsResponse.text();
      console.log("   ❌ OPTIONS failed:", text.substring(0, 200), "\n");
    }
  } catch (error) {
    console.error("   ❌ OPTIONS error:", error.message, "\n");
  }

  // Test 2: POST initialize
  console.log("2️⃣ Testing POST initialize...");
  try {
    const initResponse = await fetch(SERVER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:6274",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
      }),
    });

    console.log(`   Status: ${initResponse.status}`);
    const initData = await initResponse.json();
    console.log(
      "   Response:",
      JSON.stringify(initData, null, 2).substring(0, 300),
    );

    if (
      initResponse.status === 200 &&
      initData.jsonrpc === "2.0" &&
      initData.result
    ) {
      console.log("   ✅ Initialize successful!\n");
    } else {
      console.log("   ❌ Initialize failed or unexpected format\n");
    }
  } catch (error) {
    console.error("   ❌ Initialize error:", error.message, "\n");
  }

  // Test 3: POST tools/list
  console.log("3️⃣ Testing POST tools/list...");
  try {
    const toolsResponse = await fetch(SERVER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:6274",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/list",
        id: 2,
      }),
    });

    console.log(`   Status: ${toolsResponse.status}`);
    const toolsData = await toolsResponse.json();
    console.log(
      "   Response preview:",
      JSON.stringify(toolsData, null, 2).substring(0, 400),
    );

    if (
      toolsResponse.status === 200 &&
      toolsData.jsonrpc === "2.0" &&
      toolsData.result &&
      toolsData.result.tools
    ) {
      console.log(
        `   ✅ Tools list successful! Found ${toolsData.result.tools.length} tools\n`,
      );
    } else {
      console.log("   ❌ Tools list failed or unexpected format\n");
    }
  } catch (error) {
    console.error("   ❌ Tools list error:", error.message, "\n");
  }

  // Test 4: POST tools/call (simple tool)
  console.log("4️⃣ Testing POST tools/call (list_languages)...");
  try {
    const callResponse = await fetch(SERVER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:6274",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "list_languages",
          arguments: {},
        },
        id: 3,
      }),
    });

    console.log(`   Status: ${callResponse.status}`);
    const callData = await callResponse.json();
    console.log(
      "   Response preview:",
      JSON.stringify(callData, null, 2).substring(0, 400),
    );

    if (callResponse.status === 200 && callData.jsonrpc === "2.0") {
      console.log("   ✅ Tools call successful!\n");
    } else {
      console.log("   ❌ Tools call failed or unexpected format\n");
    }
  } catch (error) {
    console.error("   ❌ Tools call error:", error.message, "\n");
  }

  // Test 5: GET request
  console.log("5️⃣ Testing GET request...");
  try {
    const getResponse = await fetch(SERVER_URL, {
      method: "GET",
      headers: {
        Origin: "http://localhost:6274",
      },
    });

    console.log(`   Status: ${getResponse.status}`);
    const getData = await getResponse.json();
    console.log(
      "   Response:",
      JSON.stringify(getData, null, 2).substring(0, 300),
    );

    if (getResponse.status === 200) {
      console.log("   ✅ GET request successful!\n");
    } else {
      console.log("   ❌ GET request failed\n");
    }
  } catch (error) {
    console.error("   ❌ GET error:", error.message, "\n");
  }

  console.log("✨ Test complete!\n");
}

testMCPEndpoint().catch(console.error);
