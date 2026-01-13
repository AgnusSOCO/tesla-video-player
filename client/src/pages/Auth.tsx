import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import QRCode from "qrcode";

export default function Auth() {
  const [, setLocation] = useLocation();
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const hasGeneratedToken = useRef(false);
  const utils = trpc.useUtils();

  // Generate auth token
  const generateTokenMutation = trpc.auth.generateAuthToken.useMutation({
    onSuccess: async (data) => {
      setAuthToken(data.authToken);
      
      // Generate QR code with Telegram deep link
      const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'theteslacarbot';
      const telegramUrl = `https://t.me/${botUsername}?start=${data.authToken}`;
      const qrUrl = await QRCode.toDataURL(telegramUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
      });
      setQrCodeUrl(qrUrl);
      setIsPolling(true);
    },
  });

  // Poll for auth status
  const { data: authStatus, refetch } = trpc.auth.checkAuthStatus.useQuery(
    { authToken: authToken || "" },
    {
      enabled: isPolling && !!authToken,
      refetchInterval: 2000, // Poll every 2 seconds
      retry: false,
    }
  );

  // Login mutation to set session cookie
  const loginMutation = trpc.auth.loginWithTelegram.useMutation({
    onSuccess: async () => {
      // Session cookie set, now invalidate the auth cache and wait for it to confirm
      // This prevents the race condition where we redirect before the session is recognized
      try {
        // Invalidate the auth.me cache so it refetches with the new cookie
        await utils.auth.me.invalidate();
        // Refetch to confirm the session is valid
        const result = await utils.auth.me.fetch();
        if (result) {
          // Session confirmed, safe to redirect
          setLocation("/");
        } else {
          // Session not confirmed, try again
          console.error("Session not confirmed after login");
          setIsLoggingIn(false);
          setIsPolling(true);
        }
      } catch (error) {
        console.error("Error confirming session:", error);
        setIsLoggingIn(false);
        setIsPolling(true);
      }
    },
    onError: (error) => {
      console.error("Login failed:", error);
      setIsLoggingIn(false);
      setIsPolling(false);
    },
  });

  // Check if authenticated
  useEffect(() => {
    if (authStatus?.verified && authStatus.userId && authToken && !isLoggingIn) {
      // Stop polling and call login to set session cookie
      // Set isLoggingIn to prevent multiple login attempts
      setIsPolling(false);
      setIsLoggingIn(true);
      loginMutation.mutate({ authToken });
    }
  }, [authStatus, authToken, isLoggingIn]);

  // Generate token on mount (only once)
  useEffect(() => {
    if (!hasGeneratedToken.current) {
      hasGeneratedToken.current = true;
      generateTokenMutation.mutate();
    }
  }, []);

  if (generateTokenMutation.isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Generating authentication code...</p>
        </div>
      </div>
    );
  }

  if (generateTokenMutation.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive mb-2">
              <AlertCircle className="w-6 h-6" />
              <CardTitle>Authentication Error</CardTitle>
            </div>
            <CardDescription>
              Failed to generate authentication code. Please try again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={() => generateTokenMutation.mutate()} 
              className="w-full"
            >
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-2xl w-full">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl mb-2">Welcome to Tesla Video Player</CardTitle>
          <CardDescription className="text-base">
            Scan the QR code below with your phone to authenticate via Telegram
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* QR Code */}
          {qrCodeUrl && (
            <div className="flex justify-center">
              <div className="qr-container">
                <img 
                  src={qrCodeUrl} 
                  alt="Authentication QR Code" 
                  className="w-full h-full"
                />
              </div>
            </div>
          )}

          {/* Status */}
          <div className="text-center space-y-4">
            {isPolling && !authStatus?.verified && (
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Waiting for authentication...</span>
              </div>
            )}

            {authStatus?.verified && !isLoggingIn && (
              <div className="flex items-center justify-center gap-2 text-primary">
                <CheckCircle2 className="w-5 h-5" />
                <span>Authentication successful! Setting up session...</span>
              </div>
            )}

            {isLoggingIn && (
              <div className="flex items-center justify-center gap-2 text-primary">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Setting up your session... Please wait...</span>
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="bg-muted/50 rounded-lg p-6 space-y-3">
            <h3 className="font-semibold text-lg">How to authenticate:</h3>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Open Telegram on your phone</li>
              <li>Scan the QR code above</li>
              <li>Click "Start" in the bot conversation</li>
              <li>Wait for authentication to complete</li>
            </ol>
          </div>

          {/* Manual Link */}
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-2">
              Can't scan the QR code?
            </p>
            <Button
              variant="outline"
              onClick={() => {
                const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'theteslacarbot';
                const telegramUrl = `https://t.me/${botUsername}?start=${authToken}`;
                window.open(telegramUrl, "_blank");
              }}
            >
              Open Telegram Bot
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
