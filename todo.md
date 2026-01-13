# Tesla Video Player - Project TODO

## Backend & Database
- [x] Design database schema for videos, auth sessions, and download queue
- [x] Create tRPC procedures for video management (list, get, delete)
- [x] Implement Telegram authentication token generation and verification
- [x] Add video metadata storage (title, thumbnail, duration, file info)
- [ ] Create video streaming endpoint with range request support
- [ ] Add download queue management system

## Telegram Bot
- [x] Set up Python Telegram bot with python-telegram-bot library
- [x] Implement QR code authentication flow
- [x] Add YouTube URL validation and parsing
- [x] Integrate yt-dlp for video downloads
- [x] Create download progress notifications
- [x] Add video library listing command
- [ ] Implement video deletion command

## Frontend - Authentication
- [x] Create QR code display page for Telegram login
- [x] Implement authentication polling mechanism
- [x] Add session management with token storage
- [x] Create loading states for auth flow

## Frontend - Video Library
- [x] Design video library grid/list layout
- [x] Display video thumbnails, titles, and metadata
- [x] Add video selection and navigation
- [x] Implement empty state for no videos
- [x] Add delete video functionality
- [x] Create responsive layout for Tesla screen

## Frontend - Canvas Video Player
- [x] Implement WebCodecs VideoDecoder for frame decoding
- [x] Create canvas rendering loop with requestAnimationFrame
- [x] Add video buffering and preloading logic
- [x] Implement audio playback with Web Audio API
- [x] Synchronize audio and video timing
- [x] Create custom playback controls (play/pause/seek)
- [x] Add volume control
- [x] Implement fullscreen mode
- [x] Add loading and buffering indicators
- [x] Handle playback errors gracefully

## UI/UX Design
- [x] Choose color palette and design system
- [x] Design touch-optimized controls for Tesla
- [x] Create consistent spacing and typography
- [x] Add smooth transitions and animations
- [x] Optimize for Tesla browser viewport
- [x] Test touch interactions

## Testing & Deployment
- [x] Test video download and storage
- [x] Test canvas playback with different video formats
- [x] Verify WebCodecs API compatibility
- [x] Test authentication flow end-to-end
- [ ] Test on Tesla browser (requires actual Tesla vehicle)
- [x] Create deployment documentation
- [x] Save final checkpoint


## Deployment Restructuring
- [x] Separate frontend build configuration for Vercel
- [x] Create Railway backend configuration
- [x] Update database schema from MySQL to PostgreSQL for Supabase
- [x] Configure CORS for separate frontend/backend domains
- [x] Create Vercel deployment configuration (vercel.json)
- [x] Create Railway deployment configuration (railway.json)
- [x] Update environment variable configuration
- [x] Create separate README for frontend and backend
- [x] Update DEPLOYMENT.md for Vercel/Railway/Supabase setup
- [x] Test deployment configuration


## Railway Deployment Fix
- [x] Create proper Railway build configuration
- [x] Fix package.json build scripts for Railway
- [x] Create Dockerfile for Railway
- [ ] Test Railway deployment with Docker
- [ ] Update deployment documentation with Docker approach


## Repository Separation
- [x] Create backend-only directory structure
- [x] Create new GitHub repository for backend
- [x] Create backend zip with Telegram bot
- [ ] User uploads backend to GitHub and connects Railway
- [x] Update frontend repo to remove backend files
- [x] Update documentation with new repo structure
