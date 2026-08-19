import {
  StyleSheet,
  View,
  Text,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { useState } from "react";

export default function DashboardScreen() {
  const totalYouOwe = 120.5;
  const totalYouAreOwed = 45.0;
  const netBalance = totalYouAreOwed - totalYouOwe;

  const [debts, setDebts] = useState([
    { id: 1, to: "Alice", amount: 25, status: "unpaid" },
    { id: 2, to: "Bob", amount: 15, status: "pending" }, // Mock item yellow
    { id: 3, to: "Charlie", amount: 40, status: "settled" }, // Mock item green
  ]);

  const markAsPaid = (id: number) => {
    setDebts(
      debts.map((d) =>
        d.id === id && d.status === "unpaid" ? { ...d, status: "pending" } : d,
      ),
    );
  };

  const markAllAsPaid = () => {
    setDebts(
      debts.map((d) =>
        d.status === "unpaid" ? { ...d, status: "pending" } : d,
      ),
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container}>
        <Text style={styles.header}>Dashboard</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Net Balance</Text>
          <Text style={netBalance >= 0 ? styles.owedAmount : styles.oweAmount}>
            ${Math.abs(netBalance).toFixed(2)}{" "}
            {netBalance >= 0 ? "(Owed to you)" : "(You owe)"}
          </Text>
        </View>

        <View style={styles.debtsHeaderContainer}>
          <Text style={styles.sectionHeader}>Unsettled Debts</Text>
          <TouchableOpacity onPress={markAllAsPaid} style={styles.batchButton}>
            <Text style={styles.batchButtonText}>Mark All as Paid</Text>
          </TouchableOpacity>
        </View>

        {debts.map((debt) => (
          <View key={debt.id} style={styles.debtItem}>
            <View>
              <Text style={styles.debtTo}>To: {debt.to}</Text>
              <Text style={styles.debtAmount}>${debt.amount.toFixed(2)}</Text>
            </View>
            <View style={styles.debtActions}>
              <View
                style={[
                  styles.badge,
                  debt.status === "pending" && styles.badgePending,
                  debt.status === "settled" && styles.badgeSettled,
                  debt.status === "unpaid" && styles.badgeUnpaid,
                ]}
              >
                <Text style={styles.badgeText}>
                  {debt.status.toUpperCase()}
                </Text>
              </View>

              {debt.status === "unpaid" && (
                <TouchableOpacity
                  onPress={() => markAsPaid(debt.id)}
                  style={styles.payButton}
                >
                  <Text style={styles.payButtonText}>Mark as Paid</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
      </ScrollView>
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
  debtsHeaderContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    marginTop: 10,
  },
  sectionHeader: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },
  batchButton: {
    backgroundColor: "#2ecc71",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  batchButtonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 12,
  },
  debtItem: {
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  debtTo: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  debtAmount: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
  debtActions: {
    alignItems: "flex-end",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 6,
  },
  badgeUnpaid: {
    backgroundColor: "#e74c3c",
  },
  badgePending: {
    backgroundColor: "#f1c40f",
  },
  badgeSettled: {
    backgroundColor: "#2ecc71",
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "bold",
  },
  payButton: {
    backgroundColor: "#3498db",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  payButtonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 12,
  },
});
