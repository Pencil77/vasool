import { StyleSheet, View, Text, SafeAreaView } from 'react-native';

export default function DashboardScreen() {
  const totalYouOwe = 120.50;
  const totalYouAreOwed = 45.00;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.header}>Dashboard</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Total You Owe</Text>
          <Text style={styles.oweAmount}>${totalYouOwe.toFixed(2)}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Total You Are Owed</Text>
          <Text style={styles.owedAmount}>${totalYouAreOwed.toFixed(2)}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  container: {
    flex: 1,
    padding: 20,
  },
  header: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
  },
  card: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  oweAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#e74c3c',
  },
  owedAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#2ecc71',
  },
});
