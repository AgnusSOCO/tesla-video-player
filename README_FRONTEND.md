# Tesla Video Player - Frontend

React frontend for Tesla Video Player. Displays video library and plays videos using canvas-based rendering to bypass Tesla's video blocking.

## Tech Stack

- **React 19** with TypeScript
- **Vite** - Build tool
- **TailwindCSS 4** - Styling
- **tRPC** - Type-safe API client
- **Wouter** - Routing
- **Radix UI** - UI components
- **WebCodecs API** - Canvas-based video playback

## Environment Variables

Create `.env` file in the `client` directory:

```bash
# Backend API URL
VITE_API_URL=https://your-backend.railway.app
```

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173`

## Production Deployment

### Vercel (Recommended)

1. Push this repository to GitHub
2. Go to https://vercel.com/new
3. Import your GitHub repository
4. Configure:
   - **Build Command**: `npm run build`
   - **Output Directory**: `client/dist`
   - **Install Command**: `npm install`
5. Add environment variable:
   - `VITE_API_URL` = your Railway backend URL
6. Deploy!

### Manual Build

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

The built files will be in `client/dist/`

## Backend Repository

The backend API and Telegram bot are in a separate repository:
https://github.com/AgnusSOCO/tesla-video-backend

## License

MIT
