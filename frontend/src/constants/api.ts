import { Platform } from "react-native";

export let API_URL = "http://localhost:8000";

if (Platform.OS === "web" && typeof window !== "undefined") {
  if (window.location.hostname.includes("cloudshell.dev")) {
    // Magically map the 8081 web preview port to the 8000 backend port!
    API_URL = window.location.origin.replace("8081", "8000");
  }
}
