# Tesla Video Player - Deployment Guide

This guide covers the complete setup and deployment of the Tesla Video Player application, including the web app and Telegram bot.

## Overview

The Tesla Video Player consists of two main components:

1. **Web Application** - React frontend + Node.js backend (already deployed on Manus)
2. **Telegram Bot** - Python service for authentication and video downloads

## Prerequisites

- Telegram account
- Access to a server for running the Telegram bot (VPS, cloud instance, etc.)
- Python 3.8+ installed on the bot server
- ffmpeg installed (for yt-dlp video processing)

## Part 1: Create Telegram Bot

### 1.1 Create Bot with BotFather

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` command
3. Choose a name for your bot (e.g., "Tesla Video Player")
4. Choose a username (must end in 'bot', e.g., "tesla_video_player_bot")
5. Save the bot token provided by BotFather (you'll need this later)

### 1.2 Configure Bot Settings

Send these commands to BotFather:

```
/setdescription
[Select your bot]
Watch YouTube videos in your Tesla while driving. Download videos via Telegram and play them with a canvas-based player that bypasses Tesla's video blocking.

/setabouttext
[Select your bot]
Tesla Video Player - Watch YouTube videos while driving

/setcommands
[Select your bot]
start - Get started with the bot
help - Show help and instructions
list - List your downloaded videos
auth - Authenticate with the web app
```

## Part 2: Deploy Telegram Bot

### 2.1 Prepare Server

SSH into your server and install dependencies:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Python and pip
sudo apt install python3 python3-pip -y

# Install ffmpeg (required by yt-dlp)
sudo apt install ffmpeg -y

# Install git (if not already installed)
sudo apt install git -y
```

### 2.2 Upload Bot Code

Copy the `telegram-bot` directory to your server:

```bash
# On your local machine
scp -r telegram-bot user@your-server:/home/user/

# Or clone from your repository
git clone your-repo-url
cd your-repo/telegram-bot
```

### 2.3 Install Python Dependencies

```bash
cd telegram-bot
pip3 install -r requirements.txt
```

### 2.4 Configure Environment Variables

Create a `.env` file or set environment variables:

```bash
export TELEGRAM_BOT_TOKEN="your_bot_token_from_botfather"
export DATABASE_URL="your_database_url_from_manus"
export WEB_APP_URL="https://your-app.manus.space"
export DOWNLOAD_PATH="/home/user/tesla-videos"
```

**Getting the DATABASE_URL:**
- Go to your Manus project dashboard
- Navigate to Database settings
- Copy the connection string

### 2.5 Update Bot Username in Code

Edit `telegram-bot/bot.py` and replace `YOUR_BOT_USERNAME` with your actual bot username:

```python
# Line ~50 and ~200
telegram_url = f"https://t.me/your_actual_bot_username?start={data.authToken}"
```

Also update `client/src/pages/Auth.tsx`:

```typescript
// Line ~50 and ~120
const telegramUrl = `https://t.me/your_actual_bot_username?start=${authToken}`;
```

### 2.6 Test Bot Manually

Run the bot manually to test:

```bash
python3 bot.py
```

Send `/start` to your bot in Telegram. If it responds, the bot is working!

Press Ctrl+C to stop the bot.

### 2.7 Set Up Bot as Service (Production)

Create a systemd service file:

```bash
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
Environment="TELEGRAM_BOT_TOKEN=your_token"
Environment="DATABASE_URL=your_database_url"
Environment="WEB_APP_URL=https://your-app.manus.space"
Environment="DOWNLOAD_PATH=/home/your-username/tesla-videos"
ExecStart=/usr/bin/python3 /home/your-username/telegram-bot/bot.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable tesla-video-bot
sudo systemctl start tesla-video-bot
```

Check status:

```bash
sudo systemctl status tesla-video-bot
```

View logs:

```bash
sudo journalctl -u tesla-video-bot -f
```

## Part 3: Configure Web App

### 3.1 Update Bot Username

In the Manus web editor, update the bot username in:

1. `client/src/pages/Auth.tsx` (lines ~50 and ~120)
2. Redeploy the web app

### 3.2 Test Authentication Flow

1. Open your web app in a browser: `https://your-app.manus.space`
2. You should see the authentication page with a QR code
3. Scan the QR code with your phone
4. It should open your Telegram bot
5. Click "Start" in the bot
6. The web app should automatically authenticate and redirect to the video library

## Part 4: Set Up Video Storage (Production)

For production use, you should upload videos to S3 instead of storing them locally.

### 4.1 Configure S3 Storage

The web app already has S3 configured through Manus. Update the bot to upload to S3:

```python
# In telegram-bot/bot.py, after downloading video
from boto3 import client as boto3_client

s3 = boto3_client('s3',
    aws_access_key_id='your_key',
    aws_secret_access_key='your_secret',
    endpoint_url='your_s3_endpoint'
)

# Upload to S3
with open(downloaded_file, 'rb') as f:
    s3.upload_fileobj(f, 'your-bucket', file_key)

file_url = f"https://your-bucket.s3.amazonaws.com/{file_key}"
```

### 4.2 Update Video Streaming Endpoint

Add a video streaming endpoint in `server/routers.ts` to serve videos with range request support:

```typescript
// Add to server/_core/index.ts
app.get('/api/videos/stream/:youtubeId', async (req, res) => {
  // Implement range request support for video streaming
  // This allows seeking in videos
});
```

## Part 5: Using the Application

### 5.1 First Time Setup (Tesla Browser)

1. Open Tesla browser
2. Navigate to your web app URL: `https://your-app.manus.space`
3. Scan the QR code with your phone
4. Authenticate via Telegram bot
5. You're ready to use the app!

### 5.2 Downloading Videos

1. Find a YouTube video you want to watch
2. Copy the video URL
3. Open the Telegram bot on your phone
4. Send the YouTube URL to the bot
5. Wait for download to complete (bot will notify you)
6. Refresh the web app in your Tesla to see the video

### 5.3 Watching Videos

1. Open the web app in your Tesla browser
2. Click on any video thumbnail
3. The canvas-based player will open
4. Use the touch controls to play, pause, seek, and adjust volume
5. The video will play even while driving!

## Troubleshooting

### Bot Not Responding

**Check bot status:**
```bash
sudo systemctl status tesla-video-bot
sudo journalctl -u tesla-video-bot -f
```

**Common issues:**
- Wrong bot token
- Database connection failed
- Missing Python dependencies

### Videos Not Downloading

**Check logs:**
```bash
sudo journalctl -u tesla-video-bot -f
```

**Common issues:**
- ffmpeg not installed
- yt-dlp can't access YouTube (network/firewall)
- Insufficient disk space
- Video is restricted or unavailable

### Authentication Not Working

**Check:**
- Bot username is correct in Auth.tsx
- Database connection is working
- QR code is generating correctly
- Telegram bot is running

### Video Playback Issues

**If videos don't play in Tesla:**
- Ensure you're using the canvas player (not video element)
- Check video format (should be MP4/H.264)
- Verify video URL is accessible
- Check browser console for errors

### Canvas Player Not Working

**If the canvas player shows errors:**
- Tesla browser should support WebCodecs API (Chromium 109+)
- Fallback player uses hidden video element + canvas rendering
- Check that video file is accessible
- Verify CORS headers if using external storage

## Security Considerations

1. **Bot Token**: Keep your bot token secret, never commit to git
2. **Database URL**: Store securely, use environment variables
3. **S3 Credentials**: Use IAM roles or secure credential storage
4. **Video URLs**: Consider signed URLs with expiration
5. **Rate Limiting**: Implement rate limiting on downloads to prevent abuse

## Performance Optimization

1. **Video Quality**: Download appropriate quality (720p recommended for Tesla)
2. **Compression**: Use efficient video codecs (H.264)
3. **CDN**: Use CloudFront or similar CDN for video delivery
4. **Caching**: Implement caching for video metadata
5. **Cleanup**: Periodically clean up old videos to save storage

## Monitoring

### Bot Monitoring

```bash
# Check if bot is running
ps aux | grep bot.py

# View recent logs
sudo journalctl -u tesla-video-bot --since "1 hour ago"

# Check disk space
df -h
```

### Database Monitoring

Use Manus dashboard to monitor:
- Number of users
- Number of videos
- Download queue status
- Failed downloads

## Backup and Recovery

### Database Backup

Use Manus built-in backup features or:

```bash
# Manual backup
mysqldump -h host -u user -p database > backup.sql
```

### Video Backup

If using local storage:

```bash
# Backup videos
tar -czf videos-backup.tar.gz /home/user/tesla-videos
```

If using S3:
- S3 already provides durability
- Enable versioning for additional protection

## Scaling

### For High Traffic

1. **Multiple Bot Instances**: Run multiple bot instances with load balancing
2. **Queue System**: Use Redis or RabbitMQ for download queue
3. **Worker Processes**: Separate download workers from bot
4. **CDN**: Use CDN for video delivery
5. **Database**: Use read replicas for video listing

## Cost Estimation

**Monthly Costs (approximate):**
- Bot Server (VPS): $5-20/month
- Storage (100GB): $2-5/month
- Bandwidth (1TB): $10-20/month
- Manus Hosting: Free tier or paid plan
- **Total**: ~$20-50/month for moderate usage

## Support

For issues or questions:
- Check logs first
- Review this documentation
- Check the GitHub issues (if applicable)
- Contact support

## License

This project is provided as-is for personal use. Ensure you comply with YouTube's Terms of Service when downloading videos.
