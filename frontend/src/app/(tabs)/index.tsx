import { StyleSheet, View, Text, SafeAreaView } from "react-native";

export default function DashboardScreen() {
  const totalYouOwe = 120.5;
  const totalYouAreOwed = 45.0;
  const netBalance = totalYouAreOwed - totalYouOwe;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.header}>Dashboard</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Net Balance</Text>
          <Text style={netBalance >= 0 ? styles.owedAmount : styles.oweAmount}>
            ${Math.abs(netBalance).toFixed(2)}{" "}
            {netBalance >= 0 ? "(Owed to you)" : "(You owe)"}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  container: {
    flex: 1,
    padding: 20,
  },
  header: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 20,
    color: "#333",
  },
  card: {
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 8,
  },
  oweAmount: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#e74c3c",
  },
  owedAmount: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#2ecc71",
  },
});
