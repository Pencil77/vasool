import { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  SafeAreaView,
  FlatList,
  TextInput,
  TouchableOpacity,
  Switch,
} from "react-native";

const mockGangs = [
  { id: "1", name: "Goa Trip 2023", members: 5 },
  { id: "2", name: "Roommates", members: 3 },
  { id: "3", name: "Office Lunch", members: 8 },
];

export default function GangsScreen() {
  const [isCreating, setIsCreating] = useState(false);
  const [newGangName, setNewGangName] = useState("");
  const [publishMode, setPublishMode] = useState<"Live" | "Manual">("Live");
  const [showEventAmounts, setShowEventAmounts] = useState(true);

  const renderItem = ({ item }: { item: (typeof mockGangs)[0] }) => (
    <View style={styles.gangCard}>
      <Text style={styles.gangName}>{item.name}</Text>
      <Text style={styles.gangMembers}>{item.members} members</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.header}>Your Gangs</Text>
          <TouchableOpacity
            onPress={() => setIsCreating(!isCreating)}
            style={styles.toggleButton}
          >
            <Text style={styles.toggleButtonText}>
              {isCreating ? "Cancel" : "+ New"}
            </Text>
          </TouchableOpacity>
        </View>

        {isCreating && (
          <View style={styles.createCard}>
            <Text style={styles.cardTitle}>Create New Gang</Text>

            <TextInput
              style={styles.input}
              placeholder="Gang Name"
              value={newGangName}
              onChangeText={setNewGangName}
            />

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Publish Mode</Text>
              <View style={styles.radioGroup}>
                <TouchableOpacity
                  style={[
                    styles.radioBtn,
                    publishMode === "Live" && styles.radioBtnActive,
                  ]}
                  onPress={() => setPublishMode("Live")}
                >
                  <Text
                    style={[
                      styles.radioText,
                      publishMode === "Live" && styles.radioTextActive,
                    ]}
                  >
                    Live
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.radioBtn,
                    publishMode === "Manual" && styles.radioBtnActive,
                  ]}
                  onPress={() => setPublishMode("Manual")}
                >
                  <Text
                    style={[
                      styles.radioText,
                      publishMode === "Manual" && styles.radioTextActive,
                    ]}
                  >
                    Manual
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Show Event Amounts</Text>
              <Switch
                value={showEventAmounts}
                onValueChange={setShowEventAmounts}
              />
            </View>

            <TouchableOpacity
              style={styles.createButton}
              onPress={() => setIsCreating(false)}
            >
              <Text style={styles.createButtonText}>Create Gang</Text>
            </TouchableOpacity>
          </View>
        )}

        <FlatList
          data={mockGangs}
          keyExtractor={(item) => item.id}
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
    backgroundColor: "#f5f5f5",
  },
  container: {
    flex: 1,
    padding: 20,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  header: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#333",
  },
  toggleButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  toggleButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  createCard: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 16,
    color: "#333",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  settingLabel: {
    fontSize: 16,
    color: "#333",
    flex: 1,
  },
  radioGroup: {
    flexDirection: "row",
    gap: 8,
  },
  radioBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#007AFF",
  },
  radioBtnActive: {
    backgroundColor: "#007AFF",
  },
  radioText: {
    color: "#007AFF",
  },
  radioTextActive: {
    color: "#fff",
  },
  createButton: {
    backgroundColor: "#28a745",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  createButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  listContent: {
    gap: 12,
  },
  gangCard: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  gangName: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  gangMembers: {
    fontSize: 14,
    color: "#888",
  },
});
