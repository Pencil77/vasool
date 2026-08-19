import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Tabs } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: '#2f95dc' }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Dashboard',
            tabBarIcon: () => null,
          }}
        />
        <Tabs.Screen
          name="gangs"
          options={{
            title: 'Gangs',
            tabBarIcon: () => null,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: () => null,
          }}
        />
      </Tabs>
    </ThemeProvider>
  );
}
