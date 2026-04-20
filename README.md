# CF Trainer

A browser extension that helps you systematically upsolve Codeforces contests by maintaining a queue of contests and presenting unsolved problems sorted by difficulty rating.

## Features

- **Add Contests to Queue**: Easily add any Codeforces contest to your upsolving queue
- **Sorted Problem List**: View all unsolved problems from your queued contests, automatically sorted by estimated rating
- **Progress Tracking**: Automatically syncs with your Codeforces submissions to mark problems as solved
- **Simple Interface**: Clean, focused UI accessible via browser extension popup or side panel

## Installation

### From GitHub Releases (Recommended)

1. Go to the [Releases page](https://github.com/your-username/cf-trainer/releases)
2. Download the latest `cf-trainer-chrome-vX.X.zip` file
3. Unzip the downloaded file
4. Open Chrome and go to `chrome://extensions/`
5. Enable "Developer mode" in the top right
6. Click "Load unpacked" and select the unzipped folder

### Manual Build (For Developers)

#### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

#### Building the Extension

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd cf-trainer
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build for your browser:
   - For Chrome:
     ```bash
     npm run build:chrome
     ```
   - For Firefox:
     ```bash
     npm run build:firefox
     ```

#### Loading the Extension

##### Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select the `dist` folder (for Chrome) or `dist-firefox` folder (for Firefox)

##### Firefox

1. Open Firefox and go to `about:debugging`
2. Click "This Firefox" in the sidebar
3. Click "Load Temporary Add-on"
4. Select the `manifest.json` file from the built extension folder

## Usage

### Initial Setup

1. Click the extension icon in your browser toolbar
2. Go to Options (accessible via the extension menu or options page)
3. Enter your Codeforces API key and secret (get these from [Codeforces API settings](https://codeforces.com/settings/api))
4. Enter your Codeforces handle

### Adding Contests

1. Navigate to any Codeforces contest page (e.g., `https://codeforces.com/contest/123`)
2. Click the extension icon
3. Click "Add to Queue" to add the contest to your upsolving queue

### Viewing Your Upsolving Queue

- Open the extension's side panel or popup to see all unsolved problems from your queued contests
- Problems are automatically sorted by estimated rating (easiest first)
- Problems are marked as solved when you submit correct solutions on Codeforces
- Click the refresh button to sync your latest submissions

## Development

### Running in Development Mode

- Chrome: `npm run dev:chrome`
- Firefox: `npm run dev:firefox`

This will start a development server with hot reloading.

### Project Structure

```
cf-trainer/
├── core/                    # Core business logic
│   ├── services/           # API and data services
│   └── ui/                 # User interface components
├── targets/                # Browser-specific builds
│   └── chrome/             # Chrome extension files
├── public/                 # Static assets
└── dist/                   # Built extension (generated)
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

ISC License - see package.json for details

## Disclaimer

This extension is not officially affiliated with Codeforces. Use at your own risk and in accordance with Codeforces terms of service.
