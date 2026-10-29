# Translation Helps MCP Server - Epic 2025 UI 🚀

Welcome to the future of Bible AI interfaces! This is a stunning, modern SvelteKit application that showcases the power of the Translation Helps MCP Server with an immersive, interactive experience.

## ✨ Features

### 🎨 **Epic 2025 Design**

- **Dark Theme with Glassmorphism**: Beautiful frosted glass effects and modern aesthetics
- **Smooth Animations**: Fluid transitions and micro-interactions throughout
- **Responsive Design**: Perfect on desktop, tablet, and mobile devices
- **Gradient Accents**: Purple to blue gradients for that futuristic feel

### 🔧 **Comprehensive Testing Interface**

- **Individual Endpoint Testing**: Test each API endpoint with custom parameters
- **Bulk Testing Suite**: Run comprehensive test suites with timing analysis
- **Real-time Results**: See API responses with beautiful visualizations
- **Debug Output**: Copy-paste friendly debug information for troubleshooting

### 🤖 **AI Chat Interface**

- **Natural Language Queries**: Ask questions in plain English
- **Real-time API Integration**: Seamlessly calls the MCP server endpoints
- **Rich Response Display**: Beautiful formatting of scripture, notes, and word definitions
- **API Call Visualization**: See exactly which endpoints were called and when

### 📚 **Beautiful Data Visualization**

- **Bible Verse Component**: Stunning display of scripture with interactive actions
- **Translation Word Component**: Rich word definitions with semantic domains
- **Translation Notes**: Color-coded notes and insights
- **Translation Questions**: Q&A format for common challenges

### 📖 **Complete API Reference**

- **Interactive Documentation**: Test endpoints directly from the docs
- **Parameter Tables**: Clear explanation of all API parameters
- **Example Responses**: See exactly what each endpoint returns
- **Integration Guide**: Learn how to use the MCP server

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
cd ui
npm install
```

### Development

```bash
npm run dev
```

The UI will be available at `http://localhost:5173`

### Building for Production

```bash
npm run build
```

## 🎯 How to Use

### v1 Routes Now Redirect to v2

- The v1 site pages now return a temporary `302` redirect to v2 pages.
- `"/"` and legacy top-level content pages redirect to `"/v2/"`.
- Legacy feature pages redirect to their closest v2 equivalents:
  - `"/getting-started"` → `"/v2/connect"`
  - `"/mcp-tools"` → `"/v2/tools"`
  - `"/api-explorer"` and `"/api-explorer-v2"` → `"/v2/try"`
  - `"/chat"`, `"/chat/sdk-integration"`, and `"/docs/*"` → `"/v2/docs"`
- API and MCP endpoints are unchanged and do not redirect:
  - `"/api/*"` stays on v1
  - `"/mcp"` stays on v1

### 1. **Overview Page** (`/`)

- Learn about the Translation Helps MCP Server
- Understand its capabilities and use cases
- Quick start guide for integration

### 2. **Test Interface** (`/test`)

- **Individual Tests**: Configure parameters and test specific endpoints
- **Bulk Tests**: Run comprehensive test suites with timing analysis
- **Beautiful Results**: See API responses rendered with custom components
- **Debug Output**: Copy-paste friendly logs for troubleshooting

### 3. **AI Chat** (`/chat`)

- Ask natural language questions about the Bible
- See how the MCP server processes queries
- View API calls in real-time
- Experience the power of AI-powered Bible study

### 4. **API Reference** (`/api`)

- Complete documentation for all endpoints
- Interactive examples you can test
- Parameter explanations and response formats
- Integration guides for different use cases

## 🎨 Design System

### Color Palette

- **Primary**: Purple (`#a855f7`) to Blue (`#3b82f6`) gradients
- **Background**: Dark slate (`#0f172a`) with glassmorphism effects
- **Text**: White and gray variations for hierarchy
- **Accents**: Green for success, red for errors, yellow for warnings

### Components

- **BibleVerse**: Beautiful scripture display with interactive actions
- **TranslationWord**: Rich word definitions with expandable details
- **Glass Cards**: Consistent glassmorphism design throughout
- **Animated Buttons**: Smooth hover and click effects

### Typography

- **Headings**: Bold, gradient text for impact
- **Body**: Clean, readable fonts with proper spacing
- **Code**: Monospace fonts for technical content

## 🔧 Technical Stack

- **Framework**: SvelteKit 2.0
- **Styling**: Tailwind CSS 4.0 with custom components
- **Icons**: Lucide Svelte
- **Animations**: Svelte transitions and CSS animations
- **Deployment**: Netlify with serverless functions

## 🌟 Showcase Features

### For Bible App Developers

- **Reference Implementation**: See how to build beautiful Bible interfaces
- **Component Library**: Reusable components for scripture display
- **API Integration**: Examples of how to use the MCP server
- **Performance**: Optimized for fast loading and smooth interactions

### For LLM Developers

- **MCP Integration**: See how the server works with AI assistants
- **Natural Language Processing**: Examples of query parsing and routing
- **Response Formatting**: How to present Bible data beautifully
- **Error Handling**: Robust error states and user feedback

### For Translation Teams

- **Translation Notes**: Beautiful display of translation insights
- **Word Studies**: Rich semantic domain information
- **Cross-references**: Easy navigation between related content
- **Multi-language Support**: Framework ready for internationalization

## 🚀 Deployment

The UI is designed to deploy alongside the Netlify functions:

1. **Build the UI**: `npm run build`
2. **Deploy to Netlify**: The `netlify.toml` configures everything automatically
3. **API Integration**: Functions are served from `/.netlify/functions/` and proxied to `/api/`

## 🎯 Future Enhancements

- **Real-time Collaboration**: Multi-user Bible study sessions
- **Advanced Search**: Semantic search across all Bible content
- **Personalization**: User preferences and study history
- **Offline Support**: Progressive Web App capabilities
- **Mobile Apps**: React Native and Flutter versions

## 🤝 Contributing

This UI is part of the Translation Helps MCP Server project. Contributions are welcome!

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is part of the Translation Helps MCP Server and follows the same licensing terms.

---

**Built with ❤️ for the future of Bible AI** 🚀✨
