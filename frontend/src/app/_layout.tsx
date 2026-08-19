import { Slot, useRouter, useSegments } from "expo-router";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { useEffect } from "react";
import * as SplashScreen from "expo-splash-screen";

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const { isAuthenticated } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    // Basic auth protection
    const inAuthGroup = segments[0] === "login" || segments[0] === "signup";

    if (!isAuthenticated && !inAuthGroup) {
      // Redirect to the login page
      router.replace("/login");
    } else if (isAuthenticated && inAuthGroup) {
      // Redirect away from the login page
      router.replace("/(tabs)");
    } else if (isAuthenticated && segments.length === 0) {
      router.replace("/(tabs)");
    }
  }, [isAuthenticated, segments, router]);

  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return <Slot />;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}
