# YT Feed Filter

A Chrome/Brave extension that removes repetitive YouTube homepage recommendations. If YouTube keeps showing you the same videos you don't want to watch — this extension tracks them and hides them after they appear too many times.

![Chrome](https://img.shields.io/badge/Chrome-Extension-green?logo=googlechrome&logoColor=white)
![Brave](https://img.shields.io/badge/Brave-Compatible-orange?logo=brave&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)

## The Problem

YouTube's homepage algorithm keeps recommending the same videos over and over, even after dozens of reloads. There's no built-in way to tell YouTube "I'm not interested in this specific video" without clicking on it.

## The Solution

YT Feed Filter tracks how many times each video appears on your homepage across reloads. Once a video exceeds a configurable threshold (default: 3 appearances) without being clicked, it's automatically removed from the main feed and moved to a sidebar panel.

### Key Features

- **Smart Filtering** — Only hides videos you've repeatedly ignored, not your entire feed
- **Sidebar Panel** — Filtered videos are shown in a collapsible sidebar with thumbnails, so you can still access them if needed
- **Click Detection** — If you click a video to watch it, it's permanently exempted from filtering
- **Content Protection** — Never filters upcoming live streams, active streams, premieres, playlists, or videos from subscribed channels (all configurable)
- **Channel Blocking** — Block specific channels to always hide their videos
- **Configurable Threshold** — Set how many appearances trigger filtering (2-50)
- **Sidebar Customization** — Position (left/right), resizable width, auto-collapse, theme override
- **Dark Mode Support** — Automatically matches YouTube's theme
- **No Data Collection** — Everything is stored locally in your browser

## Installation

### From Source (Developer Mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/Srajan-Bansal/yt-feed-filter.git
   ```

2. Open your browser's extension page:
   - **Chrome**: Navigate to `chrome://extensions`
   - **Brave**: Navigate to `brave://extensions`

3. Enable **Developer mode** (toggle in the top right)

4. Click **Load unpacked** and select the cloned `yt-feed-filter` folder

5. Visit [youtube.com](https://youtube.com) — the extension starts tracking immediately

## How It Works

1. **Tracking** — Every time you load the YouTube homepage, the extension records which videos appear in your feed
2. **Counting** — Each video's appearance count increments with every reload
3. **Filtering** — Once a video exceeds the threshold and you haven't clicked on it, it's hidden from the grid
4. **Sidebar** — Hidden videos are moved to a sidebar panel where you can still see and access them
5. **Grid Reflow** — The main feed reflows naturally with no empty gaps

## Settings

Click the extension icon to access the popup with two tabs:

### Dashboard
- Total tracked / filtered / channels stats
- Top 10 most-ignored videos with unfilter option

### Settings
| Setting | Default | Description |
|---------|---------|-------------|
| Enable filtering | ON | Master on/off switch |
| Threshold | 3 | Appearances before filtering |
| Protect upcoming streams | ON | Never filter scheduled streams |
| Protect live streams | ON | Never filter active broadcasts |
| Protect premieres | ON | Never filter premieres |
| Protect playlists | ON | Never filter playlists/mixes |
| Protect subscribed channels | ON | Never filter subscribed channels |
| Sidebar position | Right | Left or right side |
| Sidebar width | 360px | Resizable 280-600px |
| Auto-collapse | OFF | Start with sidebar collapsed |
| Theme | Auto | Auto/Light/Dark |
| Data retention | 30 days | Auto-cleanup old data |
| Blocked channels | — | Always hide specific channels |

## Tech Stack

- **Manifest V3** — Latest Chrome extension standard
- **Vanilla JS** — No frameworks, no build step, no dependencies
- **Chrome Storage API** — Local storage for tracking data
- **MutationObserver** — Handles YouTube's SPA navigation and infinite scroll

## Privacy

This extension:
- Does **not** collect or transmit any data
- Does **not** require any network permissions
- Stores all data locally using `chrome.storage.local`
- Only runs on `youtube.com`

## Support the Project

If this extension saves you from YouTube recommendation fatigue, consider supporting its development:

[![Support via Razorpay](https://img.shields.io/badge/Support-Razorpay-2962FF?logo=razorpay&logoColor=white)](https://razorpay.me/@srajanbansal)

## License

MIT License — see [LICENSE](LICENSE) for details.
