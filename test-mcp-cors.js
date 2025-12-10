#!/usr/bin/env node
/**
 * Test script to verify MCP endpoint CORS headers
 */

const SERVER_URL = 'http://localhost:8177/api/mcp';

async function testCORS() {
  console.log('🧪 Testing MCP Endpoint CORS Headers...\n');

  // Test 1: OPTIONS preflight request
  console.log('1️⃣ Testing OPTIONS (preflight)...');
  try {
    const optionsResponse = await fetch(`${SERVER_URL}`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:6274',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    });

    const corsHeaders = {
      'access-control-allow-origin': optionsResponse.headers.get('access-control-allow-origin'),
      'access-control-allow-methods': optionsResponse.headers.get('access-control-allow-methods'),
      'access-control-allow-headers': optionsResponse.headers.get('access-control-allow-headers')
    };

    console.log('   Status:', optionsResponse.status);
    console.log('   CORS Headers:', JSON.stringify(corsHeaders, null, 2));

    if (corsHeaders['access-control-allow-origin'] === '*') {
      console.log('   ✅ CORS preflight working!\n');
    } else {
      console.log('   ❌ CORS preflight missing headers\n');
    }
  } catch (error) {
    console.log('   ❌ Error:', error.message);
    console.log('   💡 Make sure the dev server is running: cd ui && npm run dev\n');
    return;
  }

  // Test 2: GET request
  console.log('2️⃣ Testing GET request...');
  try {
    const getResponse = await fetch(`${SERVER_URL}`);
    const data = await getResponse.json();
    
    console.log('   Status:', getResponse.status);
    console.log('   Response:', JSON.stringify(data, null, 2).substring(0, 200) + '...');
    console.log('   CORS Header:', getResponse.headers.get('access-control-allow-origin'));
    
    if (getResponse.headers.get('access-control-allow-origin') === '*') {
      console.log('   ✅ GET request has CORS headers!\n');
    } else {
      console.log('   ❌ GET request missing CORS headers\n');
    }
  } catch (error) {
    console.log('   ❌ Error:', error.message, '\n');
  }

  // Test 3: POST request
  console.log('3️⃣ Testing POST request...');
  try {
    const postResponse = await fetch(`${SERVER_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:6274'
      },
      body: JSON.stringify({ method: 'tools/list' })
    });

    const data = await postResponse.json();
    
    console.log('   Status:', postResponse.status);
    console.log('   Tools found:', data.tools?.length || 0);
    console.log('   CORS Header:', postResponse.headers.get('access-control-allow-origin'));
    
    if (postResponse.headers.get('access-control-allow-origin') === '*') {
      console.log('   ✅ POST request has CORS headers!\n');
    } else {
      console.log('   ❌ POST request missing CORS headers\n');
    }
  } catch (error) {
    console.log('   ❌ Error:', error.message, '\n');
  }

  console.log('✨ Test complete!');
  console.log('\n📝 To use MCP Inspector:');
  console.log('   1. Make sure dev server is running: cd ui && npm run dev');
  console.log('   2. Open MCP Inspector');
  console.log('   3. Select "HTTP" transport');
  console.log('   4. Enter URL: http://localhost:8177/api/mcp');
  console.log('   5. Click Connect\n');
}

testCORS().catch(console.error);

