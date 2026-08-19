import { StyleSheet, View, Text, SafeAreaView, FlatList } from 'react-native';

const mockGangs = [
  { id: '1', name: 'Goa Trip 2023', members: 5 },
  { id: '2', name: 'Roommates', members: 3 },
  { id: '3', name: 'Office Lunch', members: 8 },
];

export default function GangsScreen() {
  const renderItem = ({ item }: { item: typeof mockGangs[0] }) => (
    <View style={styles.gangCard}>
      <Text style={styles.gangName}>{item.name}</Text>
      <Text style={styles.gangMembers}>{item.members} members</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.header}>Your Gangs</Text>
        <FlatList
          data={mockGangs}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
        />
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
  listContent: {
    gap: 12,
  },
  gangCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  gangName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  gangMembers: {
    fontSize: 14,
    color: '#888',
  },
});
