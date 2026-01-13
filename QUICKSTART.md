# Tesla Video Player - Quick Start Guide

This is a condensed deployment guide. For detailed instructions, see [DEPLOYMENT_VERCEL_RAILWAY.md](./DEPLOYMENT_VERCEL_RAILWAY.md).

## Prerequisites

- GitHub account
- Vercel account (free)
- Railway account (free trial)
- Supabase account (free)
- Telegram account

## Step 1: Database (Supabase) - 5 minutes

1. Go to [supabase.com](https://supabase.com) → Create new project
2. Name: "tesla-video-player", choose region, set password
3. Wait for project creation (~2 min)
4. Go to Settings → Database → Copy "Connection pooling" string (Transaction mode)
5. Replace `[YOUR-PASSWORD]` with your actual password
6. Run locally:
   ```bash
   export DATABASE_URL="your-connection-string"
   npm install
   npm run db:push
   ```

## Step 2: Backend (Railway) - 10 minutes

1. Push code to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/tesla-video-player.git
   git push -u origin main
   ```

2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select your repository
4. Add environment variables:
   ```
   DATABASE_URL=your-supabase-connection-string
   JWT_SECRET=generate-with-openssl-rand-base64-32
   FRONTEND_URL=https://your-app.vercel.app
   ALLOWED_ORIGINS=https://your-app.vercel.app
   PORT=3000
   NODE_ENV=production
   ```
5. Click "Generate Domain" → Save the URL

## Step 3: Frontend (Vercel) - 5 minutes

1. Go to [vercel.com](https://vercel.com) → New Project
2. Import your GitHub repository
3. Add environment variables:
   ```
   VITE_API_URL=https://your-app.railway.app
   VITE_APP_TITLE=Tesla Video Player
   ```
4. Deploy → Save the URL
5. Go back to Railway → Update `FRONTEND_URL` and `ALLOWED_ORIGINS` with your Vercel URL

## Step 4: Telegram Bot - 10 minutes

1. Open Telegram → Search @BotFather → `/newbot`
2. Name: "Tesla Video Player"
3. Username: "your_bot_name_bot"
4. Save the token

5. Update code with bot username:
   - `telegram-bot/bot.py` line ~50
   - `client/src/pages/Auth.tsx` lines ~50 and ~120
   - Replace `YOUR_BOT_USERNAME` with your actual username

6. Commit and push:
   ```bash
   git add .
   git commit -m "Update bot username"
   git push
   ```

7. Deploy bot (choose one):

   **Option A: Railway (Recommended)**
   - Create new service in same Railway project
   - Add env vars:
     ```
     TELEGRAM_BOT_TOKEN=your-token
     DATABASE_URL=your-supabase-connection-string
     WEB_APP_URL=https://your-app.vercel.app
     DOWNLOAD_PATH=/tmp/videos
     ```

   **Option B: VPS**
   - SSH to server
   - Upload `telegram-bot` folder
   - Install: `pip3 install -r requirements.txt`
   - Run: `python3 bot.py`

## Step 5: Test - 5 minutes

1. Open `https://your-app.vercel.app`
2. Scan QR code with phone
3. Open Telegram bot → Click "Start"
4. Should authenticate and show video library
5. Send YouTube URL to bot
6. Wait for download
7. Refresh web app → Click video → Should play!

## Troubleshooting

**Frontend can't connect to backend:**
- Check `VITE_API_URL` in Vercel matches Railway URL
- Check `ALLOWED_ORIGINS` in Railway includes Vercel URL

**Bot not responding:**
- Check bot token is correct
- Verify bot username is updated in code
- Check bot is running (Railway logs or `systemctl status`)

**Videos not playing:**
- Check video format (MP4/H.264)
- Verify video URL is accessible
- Check browser console for errors

## Next Steps

- Set up S3 storage for videos (see full deployment guide)
- Configure CDN for better performance
- Add rate limiting
- Monitor usage and costs

## Support

For detailed instructions and troubleshooting, see:
- [DEPLOYMENT_VERCEL_RAILWAY.md](./DEPLOYMENT_VERCEL_RAILWAY.md) - Full deployment guide
- [ENV_VARIABLES.md](./ENV_VARIABLES.md) - Environment variables reference
- [README.md](./README.md) - Project overview

---

**Total Time: ~35 minutes** ⏱️

**Total Cost: $5-10/month** 💰

**Result: Working Tesla video player!** 🚗📹
