# Tesla Video Player 🚗📹

A free, open-source solution for watching YouTube videos in your Tesla browser while driving. This application uses canvas-based rendering with the WebCodecs API to bypass Tesla's video element blocking, allowing video playback even when the vehicle is in motion.

## ⚠️ Safety Disclaimer

**This application is intended for PASSENGER use only.** The driver should always keep their eyes on the road and hands on the wheel. Distracted driving is dangerous and illegal in many jurisdictions. Use this application responsibly.

## ✨ Features

- **🎬 Canvas-Based Video Player**: Bypasses Tesla's video blocking using WebCodecs API
- **📱 Telegram Bot Integration**: Easy video downloads via Telegram
- **🔐 Secure Authentication**: QR code-based Telegram authentication
- **📚 Video Library**: Manage your downloaded videos
- **🎮 Touch-Optimized Controls**: Designed for Tesla's touchscreen
- **🌙 Tesla-Inspired Dark Theme**: Sleek UI with red accents
- **⚡ Smooth Playback**: Efficient video decoding and rendering
- **🔊 Audio Sync**: Perfect audio-video synchronization

## 🚀 Quick Deployment

Deploy in ~35 minutes using modern cloud platforms:

### Recommended Stack
- **Frontend**: Vercel (free tier)
- **Backend**: Railway ($5/month)
- **Database**: Supabase (free tier)
- **Bot**: Railway or VPS

### Quick Start

1. **Database (Supabase)** - Create project, get connection string
2. **Backend (Railway)** - Deploy from GitHub, add env vars
3. **Frontend (Vercel)** - Deploy from GitHub, add env vars
4. **Telegram Bot** - Create bot, deploy to Railway or VPS

**See [QUICKSTART.md](./QUICKSTART.md) for step-by-step instructions.**

**See [DEPLOYMENT_VERCEL_RAILWAY.md](./DEPLOYMENT_VERCEL_RAILWAY.md) for detailed guide.**

## 📖 Documentation

- **[QUICKSTART.md](./QUICKSTART.md)** - 35-minute deployment guide
- **[DEPLOYMENT_VERCEL_RAILWAY.md](./DEPLOYMENT_VERCEL_RAILWAY.md)** - Complete deployment guide
- **[ENV_VARIABLES.md](./ENV_VARIABLES.md)** - Environment variables reference
- **[telegram-bot/README.md](./telegram-bot/README.md)** - Bot setup instructions

## 🎯 How It Works

### The Problem

Tesla's browser blocks standard HTML5 `<video>` elements from playing when the vehicle is in motion. This is a safety feature to prevent driver distraction.

### The Solution

Instead of using video elements, we:

1. **Decode video frames** using the WebCodecs API or a hidden video element
2. **Render frames to canvas** using `drawImage()` and `requestAnimationFrame()`
3. **Play audio separately** using the Web Audio API
4. **Synchronize playback** to ensure smooth video and audio

Since Tesla's browser (Chromium 109+) doesn't block canvas elements, videos play smoothly even while driving!

## 🏗️ Architecture

```
┌─────────────────────┐
│   Vercel (Frontend) │  ← React + Vite
│   your-app.vercel.app│
└──────────┬──────────┘
           │
           │ HTTPS/tRPC
           ▼
┌─────────────────────┐
│  Railway (Backend)  │  ← Node.js + Express + tRPC
│  your-app.railway.app│
└──────────┬──────────┘
           │
           │ PostgreSQL
           ▼
┌─────────────────────┐
│ Supabase (Database) │  ← PostgreSQL + Storage
│  db.supabase.co     │
└─────────────────────┘
           ▲
           │
┌──────────┴──────────┐
│   Telegram Bot      │  ← Python (Railway/VPS)
│   (yt-dlp)          │
└─────────────────────┘
```

## 📋 Requirements

### Web App
- Node.js 22+
- PostgreSQL database (Supabase)
- Vercel (frontend hosting)
- Railway (backend hosting)

### Telegram Bot
- Python 3.8+
- ffmpeg
- Railway or VPS with internet access

### Tesla Browser
- Chromium 109+ (most modern Teslas)
- Internet connectivity

## 🎨 Technology Stack

### Frontend
- **React 19** - UI framework
- **TypeScript** - Type safety
- **TailwindCSS 4** - Styling
- **Wouter** - Routing
- **Canvas API** - Video rendering
- **WebCodecs API** - Video decoding
- **tRPC** - Type-safe API client

### Backend
- **Node.js + Express** - Server
- **tRPC** - Type-safe API
- **Drizzle ORM** - Database
- **PostgreSQL** - Database (Supabase)

### Telegram Bot
- **Python** - Bot logic
- **python-telegram-bot** - Telegram API
- **yt-dlp** - YouTube downloads
- **psycopg2** - PostgreSQL driver

## 🧪 Development

### Local Setup

```bash
# Clone repository
git clone https://github.com/yourusername/tesla-video-player.git
cd tesla-video-player

# Install dependencies
npm install

# Set up database (use Supabase connection string)
export DATABASE_URL="postgresql://..."
npm run db:push

# Start development server
npm run dev

# In another terminal, start frontend
npm run dev:client
```

### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test --watch

# Run specific test file
npm test videos.test.ts
```

## 📱 Usage

### Downloading Videos

1. Open Telegram bot on your phone
2. Send any YouTube video URL
3. Bot downloads and processes the video
4. Receive notification when complete

### Watching Videos

1. Open web app in Tesla browser
2. Browse your video library
3. Tap a video to start playback
4. Use touch controls for play/pause/seek/volume

### Managing Videos

- **Delete**: Tap the trash icon on any video
- **Refresh**: Pull down to refresh the library
- **Details**: Video duration and file size shown on each card

## 🎮 Controls

- **Play/Pause**: Tap the play button or video
- **Seek**: Drag the progress bar
- **Volume**: Use the volume slider
- **Fullscreen**: Tap the fullscreen button
- **Back**: Tap the back button to return to library

## 💰 Cost Estimation

### Free Tier (Testing)
- Vercel: Free
- Railway: $5 credit (free trial)
- Supabase: Free
- **Total: $0 for first month**

### Production (Moderate Usage)
- Vercel: Free
- Railway: $5/month
- Supabase: Free
- S3 Storage: $5/month
- **Total: ~$10/month**

### Production (High Usage)
- Vercel: $20/month
- Railway: $50/month
- Supabase: $25/month
- S3 + CDN: $50/month
- **Total: ~$145/month**

## 🔒 Security

- **Authentication**: Telegram-based secure auth
- **Session Management**: JWT tokens with expiration
- **Database**: Parameterized queries prevent SQL injection
- **CORS**: Configured for your domains only
- **Rate Limiting**: Prevent abuse (implement in production)

## 🚧 Known Limitations

1. **Video Format**: Only MP4/H.264 videos supported
2. **File Size**: Large videos may take time to download
3. **Storage**: Videos stored on server (use S3 for production)
4. **Seeking**: May be slow on large files without range requests
5. **Offline**: Requires internet connection

## 🛠️ Troubleshooting

### Frontend Can't Connect to Backend

- Check `VITE_API_URL` in Vercel matches Railway URL
- Verify `ALLOWED_ORIGINS` in Railway includes Vercel URL
- Ensure Railway backend is running

### Bot Not Responding

- Check bot is running (Railway logs or systemctl status)
- Verify bot token is correct
- Check database connection
- Ensure bot username is updated in code

### Videos Won't Play

- Check video format (should be MP4)
- Verify video URL is accessible
- Check browser console for errors
- Ensure WebCodecs API is supported

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

This project is provided as-is for personal use. Please comply with YouTube's Terms of Service when downloading videos.

## 🙏 Acknowledgments

- Inspired by TeslaTelek
- Uses yt-dlp for downloads
- WebCodecs API for video decoding
- Built with modern cloud platforms

## 📞 Support

For issues or questions:
- Check [DEPLOYMENT_VERCEL_RAILWAY.md](./DEPLOYMENT_VERCEL_RAILWAY.md)
- Review [QUICKSTART.md](./QUICKSTART.md)
- Check troubleshooting sections
- Open an issue on GitHub

## 🎯 Roadmap

- [x] Canvas-based video player
- [x] Telegram bot integration
- [x] QR code authentication
- [x] Video library management
- [x] Touch-optimized UI
- [x] Deployment guides for Vercel/Railway/Supabase
- [ ] S3 storage integration
- [ ] Video streaming with range requests
- [ ] Multiple quality options
- [ ] Playlist support
- [ ] Video search
- [ ] Subtitle support
- [ ] Background downloads
- [ ] Progress tracking
- [ ] Video sharing between users

## ⚖️ Legal Notice

This application is for personal use only. Users are responsible for ensuring their use complies with:

- YouTube's Terms of Service
- Local copyright laws
- Traffic laws regarding in-vehicle displays
- Tesla's vehicle usage policies

The developers assume no liability for misuse of this application.

---

**Made with ❤️ for Tesla owners who want to watch videos on the go (as passengers, of course!)**

**Deploy in 35 minutes:** [QUICKSTART.md](./QUICKSTART.md)
