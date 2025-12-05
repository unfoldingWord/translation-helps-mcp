/**
 * Basic usage example for Translation Helps MCP Client
 *
 * This example shows the correct MCP flow:
 * 1. AI receives user query + available tools
 * 2. AI decides which tools to call
 * 3. Client executes tool calls via MCP server
 * 4. Tool results fed back to AI
 * 5. AI provides final answer
 */

import { TranslationHelpsClient } from "../src/index.js";
// Import your AI provider's SDK
// import Anthropic from '@anthropic-ai/sdk';
// import OpenAI from 'openai';

async function main() {
  // Create MCP client
  const mcpClient = new TranslationHelpsClient({
    serverUrl: "https://tc-helps.mcp.servant.bible/api/mcp",
  });

  try {
    // Connect to MCP server and get available tools and prompts
    console.log("Connecting to MCP server...");
    await mcpClient.connect();

    const tools = await mcpClient.listTools();
    const prompts = await mcpClient.listPrompts();
    console.log(
      `✅ Connected! Available tools: ${tools.map((t) => t.name).join(", ")}`,
    );
    console.log(
      `✅ Available prompts: ${prompts.map((p) => p.name).join(", ")}\n`,
    );

    // Convert MCP tools to your AI provider's format
    // Each provider has different formats - refer to their documentation
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const availableTools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
      // Adapt this format to match your provider's requirements
    }));

    // Note: Prompts are typically used differently - they provide instructions/templates
    // Some AI providers support prompts as a separate feature, others integrate them as tools
    // Refer to your provider's documentation for how to use prompts

    // Initialize your AI provider's client
    // const aiClient = new YourAIProvider({
    //   apiKey: process.env.YOUR_API_KEY
    // });

    // User's question
    const userQuery =
      "What does John 3:16 say and what are the key translation considerations?";

    console.log(`User query: ${userQuery}\n`);

    // Send query to AI with available tools
    // The AI will decide which tools to call
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const messages = [{ role: "user", content: userQuery }];

    // Call your AI provider's API with tools
    // Refer to your provider's documentation for the exact API call format
    // Example pattern:
    // let response = await aiClient.messages.create({
    //   model: 'your-model',
    //   messages,
    //   tools: availableTools
    // });

    // Handle your provider's response format
    // Different providers return tool calls differently:
    // - Anthropic: response.content with tool_use items
    // - OpenAI: response.choices[0].message.tool_calls
    // - Others: Check their documentation

    // When your AI requests a tool call:
    // for (const toolCall of <extract_tool_calls_from_response>) {
    //   const toolName = toolCall.name;  // or toolCall.function.name (provider-dependent)
    //   const toolArgs = toolCall.input;  // or toolCall.function.arguments (provider-dependent)
    //
    //   console.log(`\n🔧 AI requested tool: ${toolName}`);
    //
    //   // Execute tool call via MCP server (this is where the SDK helps!)
    //   try {
    //     const result = await mcpClient.callTool(toolName, toolArgs);
    //
    //     // Extract text from tool result
    //     let toolResultText = '';
    //     if (result.content) {
    //       for (const item of result.content) {
    //         if (item.type === 'text') {
    //           toolResultText += item.text;
    //         }
    //       }
    //     }
    //
    //     console.log(`✅ Tool result received (${toolResultText.length} chars)`);
    //
    //     // Add tool result back to your AI provider's conversation format
    //     // Format depends on your provider - refer to their documentation
    //     messages.push({
    //       role: 'assistant',
    //       content: <format_assistant_message_with_tool_call>
    //     });
    //     messages.push({
    //       role: 'user',  // or 'tool' for some providers
    //       content: <format_tool_result_for_provider>
    //     });
    //
    //     // Get AI's response with the tool data
    //     // response = await aiClient.messages.create({...});
    //     // Extract final text from response
    //
    //   } catch (error) {
    //     console.error(`❌ Tool execution error: ${error}`);
    //   }
    // }

    // ============================================
    // DISCOVERY WORKFLOW EXAMPLE (New in v1.2.0)
    // ============================================
    // Recommended workflow for discovering available resources:

    // Step 1: Discover available languages (~1s)
    console.log("\n🔍 Discovery Workflow Example:");
    const languages = await mcpClient.listLanguages({ stage: "prod" });
    console.log(`✅ Found ${languages.languages?.length || 0} languages`);
    console.log(
      `   Examples: ${languages.languages
        ?.slice(0, 5)
        .map((l) => l.code)
        .join(", ")}`,
    );

    // Step 2: Get resources for a specific language (~1-2s) ⭐ RECOMMENDED
    const spanishResources = await mcpClient.listResourcesForLanguage({
      language: "es-419",
      topic: "tc-ready", // optional: production-ready resources only
    });
    console.log(
      `✅ Found ${spanishResources.totalResources || 0} resources for Spanish (es-419)`,
    );
    console.log(`   Subjects: ${spanishResources.subjects?.join(", ")}`);

    // Step 3: Use specific fetch tools with discovered language/organization
    // const scripture = await mcpClient.fetchScripture({
    //   reference: "John 3:16",
    //   language: "es-419",
    //   organization: "es-419_gl", // from resources list
    // });

    console.log("\n📝 Note: This is a template example.");
    console.log("Uncomment and adapt the code above for your AI provider.");
    console.log("The key is: AI decides → SDK executes → AI responds");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
