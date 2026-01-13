# Tesla Video Player - Deployment Guide
## Vercel (Frontend) + Railway (Backend) + Supabase (Database)

This guide covers deploying the Tesla Video Player with a modern, scalable architecture using best-in-class platforms.

## Architecture Overview

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
│   Telegram Bot      │  ← Python (separate server)
│   (VPS/Cloud)       │
└─────────────────────┘
```

## Prerequisites

- GitHub account (for code repository)
- Vercel account (free tier works)
- Railway account (free trial available)
- Supabase account (free tier works)
- Telegram account (for bot)
- VPS or cloud server for Telegram bot (optional)

---

## Part 1: Set Up Supabase Database

### 1.1 Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click "New Project"
3. Choose organization and project name: "tesla-video-player"
4. Set a strong database password (save this!)
5. Choose region closest to your users
6. Click "Create new project" (takes ~2 minutes)

### 1.2 Get Database Connection String

1. In your Supabase project dashboard, go to "Settings" → "Database"
2. Scroll to "Connection string"
3. Select "Connection pooling" → "Transaction mode"
4. Copy the connection string (looks like):
   ```
   postgresql://postgres.xxxxx:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```
5. Replace `[YOUR-PASSWORD]` with your actual database password
6. Save this connection string for later

### 1.3 Run Database Migrations

On your local machine:

```bash
# Install dependencies
npm install

# Set DATABASE_URL environment variable
export DATABASE_URL="your-supabase-connection-string"

# Run migrations
npm run db:push
```

This creates all necessary tables in your Supabase database.

### 1.4 Verify Tables Created

1. In Supabase dashboard, go to "Table Editor"
2. You should see these tables:
   - `users`
   - `telegram_sessions`
   - `videos`
   - `download_queue`

---

## Part 2: Deploy Backend to Railway

### 2.1 Prepare Repository

1. Push your code to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/yourusername/tesla-video-player.git
   git push -u origin main
   ```

### 2.2 Create Railway Project

1. Go to [railway.app](https://railway.app) and sign in
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Connect your GitHub account if not already connected
5. Select your `tesla-video-player` repository
6. Railway will automatically detect it's a Node.js project

### 2.3 Configure Environment Variables

In Railway project dashboard, go to "Variables" tab and add:

```bash
# Database
DATABASE_URL=your-supabase-connection-string

# JWT Secret (generate with: openssl rand -base64 32)
JWT_SECRET=your-random-secret-here

# Frontend URL (will update after Vercel deployment)
FRONTEND_URL=https://your-app.vercel.app

# CORS
ALLOWED_ORIGINS=https://your-app.vercel.app

# Server
PORT=3000
NODE_ENV=production
```

### 2.4 Configure Build Settings

Railway should auto-detect settings, but verify:

1. **Build Command**: `npm run railway:build`
2. **Start Command**: `npm start`
3. **Root Directory**: `/` (leave empty)

### 2.5 Deploy

1. Railway will automatically deploy after adding environment variables
2. Wait for deployment to complete (~2-3 minutes)
3. Once deployed, click "Generate Domain" to get your backend URL
4. Save this URL: `https://your-app.railway.app`

### 2.6 Verify Backend is Running

Test the backend:

```bash
curl https://your-app.railway.app/api/trpc/auth.me
```

Should return authentication info or error (expected if not logged in).

---

## Part 3: Deploy Frontend to Vercel

### 3.1 Create Vercel Project

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click "Add New..." → "Project"
3. Import your GitHub repository
4. Vercel will auto-detect it's a Vite project

### 3.2 Configure Build Settings

Vercel should auto-detect, but verify:

1. **Framework Preset**: Vite
2. **Build Command**: `npm run vercel:build`
3. **Output Directory**: `client/dist`
4. **Install Command**: `npm install`
5. **Root Directory**: `/` (leave empty)

### 3.3 Configure Environment Variables

In Vercel project settings → "Environment Variables", add:

```bash
# Backend API URL (from Railway)
VITE_API_URL=https://your-app.railway.app

# App Configuration
VITE_APP_TITLE=Tesla Video Player
VITE_APP_LOGO=
```

### 3.4 Deploy

1. Click "Deploy"
2. Wait for deployment (~1-2 minutes)
3. Once deployed, you'll get your frontend URL: `https://your-app.vercel.app`

### 3.5 Update Railway CORS Settings

Now that you have your Vercel URL, update Railway environment variables:

1. Go back to Railway project
2. Update `FRONTEND_URL` to your Vercel URL
3. Update `ALLOWED_ORIGINS` to your Vercel URL
4. Railway will automatically redeploy

---

## Part 4: Set Up Telegram Bot

### 4.1 Create Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` command
3. Choose name: "Tesla Video Player"
4. Choose username: "tesla_video_player_bot" (must end in 'bot')
5. Save the bot token provided

### 4.2 Configure Bot Commands

Send to BotFather:

```
/setdescription
[Select your bot]
Watch YouTube videos in your Tesla while driving. Download videos via Telegram and play them with a canvas-based player.

/setcommands
[Select your bot]
start - Get started
help - Show help
list - List your videos
```

### 4.3 Deploy Bot to Server

**Option A: Deploy to Railway (Recommended)**

1. Create a new Railway service in the same project
2. Add environment variables:
   ```bash
   TELEGRAM_BOT_TOKEN=your-bot-token
   DATABASE_URL=your-supabase-connection-string
   WEB_APP_URL=https://your-app.vercel.app
   DOWNLOAD_PATH=/tmp/videos
   ```
3. Railway will deploy the bot automatically

**Option B: Deploy to VPS**

```bash
# SSH into your server
ssh user@your-server

# Install dependencies
sudo apt update
sudo apt install python3 python3-pip ffmpeg -y

# Upload bot code
scp -r telegram-bot user@your-server:/home/user/

# Install Python packages
cd telegram-bot
pip3 install -r requirements.txt

# Create systemd service
sudo nano /etc/systemd/system/tesla-video-bot.service
```

Add this content:

```ini
[Unit]
Description=Tesla Video Player Telegram Bot
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/home/your-username/telegram-bot
Environment="TELEGRAM_BOT_TOKEN=your-token"
Environment="DATABASE_URL=your-supabase-connection-string"
Environment="WEB_APP_URL=https://your-app.vercel.app"
Environment="DOWNLOAD_PATH=/home/your-username/tesla-videos"
ExecStart=/usr/bin/python3 /home/your-username/telegram-bot/bot.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable tesla-video-bot
sudo systemctl start tesla-video-bot
sudo systemctl status tesla-video-bot
```

### 4.4 Update Bot Username in Code

Update these files with your actual bot username:

**File: `telegram-bot/bot.py`** (line ~50):
```python
telegram_url = f"https://t.me/your_actual_bot_username?start={auth_token}"
```

**File: `client/src/pages/Auth.tsx`** (lines ~50 and ~120):
```typescript
const telegramUrl = `https://t.me/your_actual_bot_username?start=${authToken}`;
```

Commit and push changes:

```bash
git add .
git commit -m "Update bot username"
git push
```

Vercel and Railway will automatically redeploy.

---

## Part 5: Configure S3 Storage (Optional but Recommended)

For production, store videos in S3 instead of local filesystem.

### 5.1 Create S3 Bucket

**AWS S3:**
1. Go to AWS Console → S3
2. Create bucket: "tesla-video-player"
3. Enable public access (for video streaming)
4. Create IAM user with S3 permissions
5. Generate access keys

**Alternative: Supabase Storage:**
1. In Supabase dashboard, go to "Storage"
2. Create bucket: "videos"
3. Set bucket to public
4. Get API keys from Settings → API

### 5.2 Add S3 Environment Variables

**Railway (Backend):**
```bash
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
AWS_S3_BUCKET=tesla-video-player
AWS_S3_ENDPOINT=https://s3.amazonaws.com
```

**Telegram Bot:**
```bash
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
AWS_S3_BUCKET=tesla-video-player
```

### 5.3 Update Bot to Upload to S3

Edit `telegram-bot/bot.py` to upload videos to S3 after download (implementation provided in code comments).

---

## Part 6: Testing the Complete System

### 6.1 Test Frontend

1. Open `https://your-app.vercel.app` in browser
2. Should see authentication page with QR code
3. Check browser console for errors

### 6.2 Test Authentication Flow

1. Scan QR code with phone
2. Should open Telegram bot
3. Click "Start" in bot
4. Web app should authenticate and redirect to video library

### 6.3 Test Video Download

1. Find a YouTube video
2. Send URL to Telegram bot
3. Bot should start downloading
4. Check bot logs for progress
5. Refresh web app to see video

### 6.4 Test Video Playback

1. Click on video in library
2. Canvas player should open
3. Video should play (even while "driving")
4. Test controls: play, pause, seek, volume

---

## Part 7: Monitoring and Maintenance

### 7.1 Railway Monitoring

1. Go to Railway dashboard
2. Check "Metrics" tab for:
   - CPU usage
   - Memory usage
   - Network traffic
3. View logs in "Deployments" tab

### 7.2 Vercel Monitoring

1. Go to Vercel dashboard
2. Check "Analytics" for:
   - Page views
   - Performance metrics
   - Error rates
3. View deployment logs

### 7.3 Supabase Monitoring

1. Go to Supabase dashboard
2. Check "Database" → "Usage" for:
   - Database size
   - Active connections
   - Query performance

### 7.4 Bot Monitoring

**If on VPS:**
```bash
# Check bot status
sudo systemctl status tesla-video-bot

# View logs
sudo journalctl -u tesla-video-bot -f

# Restart bot
sudo systemctl restart tesla-video-bot
```

**If on Railway:**
- View logs in Railway dashboard
- Check metrics for bot service

---

## Part 8: Troubleshooting

### Frontend Can't Connect to Backend

**Symptoms:** API errors, CORS errors in browser console

**Solutions:**
1. Verify `VITE_API_URL` in Vercel matches Railway URL
2. Check `ALLOWED_ORIGINS` in Railway includes Vercel URL
3. Ensure Railway backend is running (check logs)
4. Test backend directly: `curl https://your-app.railway.app/api/trpc/auth.me`

### Database Connection Errors

**Symptoms:** "Cannot connect to database" errors

**Solutions:**
1. Verify `DATABASE_URL` is correct in Railway
2. Check Supabase database is running
3. Ensure connection pooling is enabled
4. Test connection: `psql $DATABASE_URL -c "SELECT 1;"`

### Telegram Bot Not Responding

**Symptoms:** Bot doesn't reply to messages

**Solutions:**
1. Check bot is running: `systemctl status tesla-video-bot`
2. View logs: `journalctl -u tesla-video-bot -f`
3. Verify `TELEGRAM_BOT_TOKEN` is correct
4. Check bot username is updated in code
5. Test bot token: `curl https://api.telegram.org/bot<TOKEN>/getMe`

### Videos Not Playing

**Symptoms:** Player shows error or black screen

**Solutions:**
1. Check video file exists and is accessible
2. Verify video format (should be MP4/H.264)
3. Check browser console for errors
4. Test video URL directly in browser
5. Ensure CORS headers allow video streaming

### Authentication Not Working

**Symptoms:** QR code doesn't work, stuck on auth page

**Solutions:**
1. Check bot username is correct in Auth.tsx
2. Verify database connection
3. Check `telegram_sessions` table exists
4. View Railway logs for auth errors
5. Try manual link instead of QR code

---

## Part 9: Scaling and Optimization

### 9.1 Enable CDN for Videos

Use CloudFront (AWS) or Cloudflare for video delivery:

1. Create CloudFront distribution
2. Point origin to S3 bucket
3. Update video URLs to use CDN domain
4. Enable caching with appropriate headers

### 9.2 Optimize Database

1. Add indexes to frequently queried columns:
   ```sql
   CREATE INDEX idx_videos_user_id ON videos(user_id);
   CREATE INDEX idx_videos_youtube_id ON videos(youtube_id);
   CREATE INDEX idx_telegram_sessions_token ON telegram_sessions(auth_token);
   ```

2. Enable connection pooling (already enabled in Supabase)

### 9.3 Add Rate Limiting

Protect your API from abuse:

```typescript
// Add to server/_core/index.ts
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api', limiter);
```

### 9.4 Enable Caching

Cache video metadata and thumbnails:

```typescript
// Add Redis caching for video list
import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL);

// Cache video list for 5 minutes
const cacheKey = `videos:${userId}`;
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);

// ... fetch from database ...
await redis.setex(cacheKey, 300, JSON.stringify(videos));
```

---

## Part 10: Cost Estimation

### Free Tier Limits

**Vercel (Free):**
- 100 GB bandwidth/month
- Unlimited deployments
- Automatic HTTPS

**Railway (Free Trial → Hobby $5/mo):**
- $5 credit/month on free trial
- Then $5/month for Hobby plan
- 500 hours execution time

**Supabase (Free):**
- 500 MB database
- 1 GB file storage
- 2 GB bandwidth

**Total: ~$5-10/month** for moderate usage

### Scaling Costs

**Medium Usage (100 users, 1000 videos):**
- Vercel: Free tier sufficient
- Railway: $20/month (Pro plan)
- Supabase: $25/month (Pro plan)
- S3 Storage: $10/month (100 GB)
- **Total: ~$55/month**

**High Usage (1000 users, 10000 videos):**
- Vercel: $20/month (Pro plan)
- Railway: $50/month (Team plan)
- Supabase: $100/month (Team plan)
- S3 + CloudFront: $50/month (1 TB)
- **Total: ~$220/month**

---

## Part 11: Security Best Practices

### 11.1 Environment Variables

- Never commit `.env` files to git
- Use different secrets for dev/prod
- Rotate secrets regularly
- Use strong, random JWT secrets

### 11.2 Database Security

- Use connection pooling
- Enable SSL for database connections
- Implement row-level security in Supabase
- Regular backups (Supabase does this automatically)

### 11.3 API Security

- Implement rate limiting
- Validate all inputs
- Use HTTPS only
- Enable CORS only for your domains
- Implement authentication on all sensitive endpoints

### 11.4 Video Storage Security

- Use signed URLs with expiration
- Implement access control (users can only access their videos)
- Scan uploaded files for malware
- Limit file sizes

---

## Part 12: Backup and Recovery

### 12.1 Database Backups

Supabase automatically backs up your database daily. To create manual backup:

```bash
# Export database
pg_dump $DATABASE_URL > backup.sql

# Restore database
psql $DATABASE_URL < backup.sql
```

### 12.2 Code Backups

Your code is already backed up in GitHub. To create a release:

```bash
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin v1.0.0
```

### 12.3 Video Backups

If using S3, enable versioning:

1. Go to S3 bucket settings
2. Enable "Versioning"
3. Configure lifecycle rules to delete old versions

---

## Conclusion

You now have a fully deployed Tesla Video Player with:

- ✅ React frontend on Vercel
- ✅ Node.js backend on Railway
- ✅ PostgreSQL database on Supabase
- ✅ Telegram bot for video downloads
- ✅ Canvas-based video player that works while driving
- ✅ Scalable, production-ready architecture

**Next Steps:**

1. Test thoroughly in your Tesla browser
2. Invite friends to test
3. Monitor usage and costs
4. Optimize based on real-world usage
5. Add new features (playlists, sharing, etc.)

**Support:**

For issues or questions:
- Check logs in Railway/Vercel dashboards
- Review this documentation
- Check GitHub issues
- Test each component individually

Enjoy watching videos in your Tesla! 🚗📹
