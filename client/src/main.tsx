import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

// Debug: Log environment variables
console.log("[Tesla Video Player] Environment check:");
console.log("- VITE_API_URL:", import.meta.env.VITE_API_URL);
console.log("- MODE:", import.meta.env.MODE);
console.log("- DEV:", import.meta.env.DEV);
console.log("- PROD:", import.meta.env.PROD);

// Construct the API URL - call once at initialization
const getApiUrl = (): string => {
  const envUrl = import.meta.env.VITE_API_URL;
  
  console.log("[tRPC] getApiUrl called with envUrl:", envUrl);
  
  // If environment variable is set, use it
  if (envUrl && typeof envUrl === 'string' && envUrl.trim() !== '') {
    const cleanUrl = envUrl.replace(/\/$/, ''); // Remove trailing slash
    const finalUrl = `${cleanUrl}/api/trpc`;
    console.log("[tRPC] Using API URL:", finalUrl);
    return finalUrl;
  }
  
  // Fallback for development or missing env var
  const fallbackUrl = `${window.location.origin}/api/trpc`;
  console.log("[tRPC] Using fallback URL:", fallbackUrl);
  return fallbackUrl;
};

// Get the API URL once at initialization
const apiUrl = getApiUrl();
console.log("[tRPC] Final API URL for client:", apiUrl);

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: apiUrl, // Pass the string directly, not a function
      transformer: superjson,
      fetch(url, init) {
        console.log("[tRPC] Fetching:", url);
        return fetch(url, {
          ...init,
          credentials: "include",
        });
      },
    }),
  ],
});

console.log("[Tesla Video Player] tRPC client created successfully");

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
