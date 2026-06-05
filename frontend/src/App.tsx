import { useEffect, useState } from "react";
import "./App.css";

interface Device {
  id: number;
  name: string;
  ip: string;
  mac: string;
  status: string;
  selected: boolean;
  groupId: number | null;
  groupName?: string | null;
}

interface Group {
  id: number;
  name: string;
  deviceCount: number;
}

interface DeviceHistoryEntry {
  timestamp: string;
  time: number;
  status: string;
  note: string;
}

function App() {
  const [activePage, setActivePage] = useState("devices");
  const [showModal, setShowModal] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [deviceIp, setDeviceIp] = useState("");
  const [deviceMac, setDeviceMac] = useState("");
  const [modalGroupId, setModalGroupId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupName, setGroupName] = useState("");
  const [deviceHistory, setDeviceHistory] = useState<Record<number, DeviceHistoryEntry[]>>({});
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [groupFilter, setGroupFilter] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [backendUrl, setBackendUrl] = useState("http://localhost:5000");
  const [schedulerOn, setSchedulerOn] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState("");
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAssignGroupModal, setShowAssignGroupModal] = useState(false);
  const [selectedAssignGroupId, setSelectedAssignGroupId] = useState<number | null>(null);
  const [messageModal, setMessageModal] = useState<{
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm?: () => Promise<void> | void;
  } | null>(null);

  const baseUrl = backendUrl.replace(/\/$/, "");

  useEffect(() => {
    refreshAll();
  }, []);

  const refreshAll = async () => {
    setLoading(true);
    await Promise.all([loadDevices(), loadGroups()]);
    setLoading(false);
    setLastRefresh(new Date().toLocaleTimeString());
    setStatusMessage("Status osvježen");
    setTimeout(() => setStatusMessage(""), 2000);
  };

  const loadDevices = async () => {
    try {
      const response = await fetch(`${baseUrl}/devices`);
      const data = await response.json();
      const mappedDevices = data.map((device: any) => ({
        ...device,
        selected: false,
      }));

      setDevices(mappedDevices);
      mappedDevices.forEach((device: any) => {
        recordDeviceEvent(device, `Automatska provjera statusa: ${device.status}`);
      });
    } catch (error) {
      console.error("Učitavanje uređaja nije uspjelo:", error);
    }
  };

  const loadGroups = async () => {
    try {
      const response = await fetch(`${baseUrl}/groups`);
      const data = await response.json();
      setGroups(data);
    } catch (error) {
      console.error("Ucitavanje grupa nije uspjelo:", error);
    }
  };

  const recordDeviceEvent = (device: Device, note: string) => {
    setDeviceHistory((prevHistory) => {
      const existing = prevHistory[device.id] || [];
      const now = new Date();
      const entry: DeviceHistoryEntry = {
        timestamp: now.toLocaleTimeString(),
        time: now.getTime(),
        status: device.status,
        note,
      };
      return {
        ...prevHistory,
        [device.id]: [entry, ...existing].slice(0, 10),
      };
    });
  };

  const clearModalFields = () => {
    setDeviceName("");
    setDeviceIp("");
    setDeviceMac("");
    setModalGroupId(null);
  };

  const isValidIp = (ip: string) =>
    /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(ip);

  const isValidMac = (mac: string) =>
    /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(mac);

  const showMessage = (title: string, message: string) => {
    setMessageModal({ title, message });
  };

  const showConfirm = (
    title: string,
    message: string,
    onConfirm: () => Promise<void> | void,
    confirmText = "Potvrdi",
    cancelText = "Odustani"
  ) => {
    setMessageModal({ title, message, confirmText, cancelText, onConfirm });
  };

  const closeMessageModal = () => setMessageModal(null);

  const handleMessageConfirm = async () => {
    if (!messageModal?.onConfirm) {
      closeMessageModal();
      return;
    }

    await messageModal.onConfirm();
    closeMessageModal();
  };

  const closeAddForm = () => {
    setShowAddForm(false);
    setShowModal(false);
    setEditingId(null);
    clearModalFields();
  };

  const handleSave = async () => {
    if (!deviceName || !deviceIp || !deviceMac) {
      showMessage("Greška", "Popuni sva polja");
      return;
    }

    if (!isValidIp(deviceIp)) {
      showMessage("Greška", "IP adresa nije ispravna. Unesi format 192.168.1.10.");
      return;
    }

    if (!isValidMac(deviceMac)) {
      showMessage("Greška", "MAC adresa nije ispravna. Unesi format AA:BB:CC:DD:EE:FF.");
      return;
    }

    const payload = {
      name: deviceName,
      ip: deviceIp,
      mac: deviceMac,
      groupId: modalGroupId,
    };

    try {
      if (editingId !== null) {
        const response = await fetch(`${baseUrl}/devices/${editingId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          showMessage(
            "Greška",
            `Greška pri uređivanju uređaja: ${errorData?.error || response.statusText}`
          );
          return;
        }

        setDevices(
          devices.map((device) =>
            device.id === editingId
              ? {
                  ...device,
                  name: deviceName,
                  ip: deviceIp,
                  mac: deviceMac,
                  groupId: modalGroupId,
                  groupName:
                    groups.find((group) => group.id === modalGroupId)
                      ?.name || null,
                }
              : device
          )
        );
        setEditingId(null);
      } else {
        const response = await fetch(`${baseUrl}/devices`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          showMessage(
            "Greška",
            `Greška pri dodavanju uređaja: ${errorData?.error || response.statusText}`
          );
          return;
        }

        const newDevice = await response.json();

        setDevices([
          ...devices,
          {
            ...newDevice,
            selected: false,
            groupId: modalGroupId,
            groupName:
              groups.find((group) => group.id === modalGroupId)?.name || null,
          },
        ]);
      }

      clearModalFields();
      setShowAddForm(false);
      setShowModal(false);
      setStatusMessage("Uređaj je uspješno spremljen.");
      setTimeout(() => setStatusMessage(""), 2500);
    } catch (error) {
      console.error("Spremanje uređaja nije uspjelo:", error);
      showMessage("Greška", "Greška pri spremanju uređaja. Provjeri je li backend pokrenut.");
    }
  };

  const handlePowerOnAll = async () => {
    try {
      const response = await fetch(`${baseUrl}/devices/poweron-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        showMessage(
          "Greška",
          `Nije uspjelo paljenje svih TV-a: ${errorData?.error || response.statusText}`
        );
        return;
      }

      const data = await response.json();
      const successCount = data.results.filter((item: any) => item.poweredOn).length;
      setStatusMessage(`Poslano WOL svim uređajima. Uspješno upaljeno ${successCount} od ${data.results.length}.`);
      setTimeout(() => setStatusMessage(""), 4000);
      await refreshAll();
    } catch (error) {
      console.error("Greska pri paljenju svih TV-a:", error);
      showMessage("Greška", "Greška pri paljenju svih TV-a.");
    }
  };

  const handleDelete = async (id: number) => {
    await fetch(`${baseUrl}/devices/${id}`, {
      method: "DELETE",
    });

    setDevices(devices.filter((device) => device.id !== id));

    if (selectedDeviceId === id) {
      setSelectedDeviceId(null);
    }
  };

  const handleViewDevice = async (id: number) => {
    setSelectedDeviceId(id);
  };

  const handleClearSelection = () => {
    setSelectedDeviceId(null);
  };

  const confirmDelete = async () => {
    if (pendingDelete === null) return;
    await handleDelete(pendingDelete);
    setPendingDelete(null);
    setShowDeleteConfirm(false);
  };

  const cancelDelete = () => {
    setPendingDelete(null);
    setShowDeleteConfirm(false);
  };

  const openAssignGroupModal = () => {
    const selectedDevices = devices.filter((device) => device.selected);
    if (selectedDevices.length === 0) {
      showMessage("Greška", "Označi uređaje prije dodjeljivanja grupe.");
      return;
    }

    if (groups.length === 0) {
      showMessage("Greška", "Nema dostupnih grupa. Kreiraj grupu prvo.");
      return;
    }

    setSelectedAssignGroupId(null);
    setShowAssignGroupModal(true);
  };

  const assignGroupToSelected = async () => {
    if (selectedAssignGroupId === null) {
      showMessage("Greška", "Izaberi grupu za dodjelu.");
      return;
    }

    await fetch(`${baseUrl}/groups/${selectedAssignGroupId}/devices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceIds: devices.filter((device) => device.selected).map((device) => device.id),
      }),
    });

    await refreshAll();
    setShowAssignGroupModal(false);
    setSelectedAssignGroupId(null);
  };

  const cancelAssignGroup = () => {
    setShowAssignGroupModal(false);
    setSelectedAssignGroupId(null);
  };

  const toggleDevice = (id: number) => {
    setDevices(
      devices.map((device) =>
        device.id === id
          ? { ...device, selected: !device.selected }
          : device
      )
    );
  };

  const handleDeleteSelectedConfirmed = async () => {
    const selectedDevices = devices.filter((device) => device.selected);

    if (selectedDevices.length === 0) {
      showMessage("Greška", "Nema označenih uređaja.");
      return;
    }

    await Promise.all(
      selectedDevices.map((device) =>
        fetch(`${baseUrl}/devices/${device.id}`, {
          method: "DELETE",
        })
      )
    );

    setDevices(devices.filter((device) => !device.selected));
  };

  const handleDeleteSelected = () => {
    const selectedDevices = devices.filter((device) => device.selected);

    if (selectedDevices.length === 0) {
      showMessage("Greška", "Nema označenih uređaja.");
      return;
    }

    showConfirm(
      "Potvrda brisanja",
      "Obrisati označene uređaje?",
      handleDeleteSelectedConfirmed,
      "Obriši",
      "Odustani"
    );
  };

  const handleRestartSelected = async () => {
    const selectedIds = devices
      .filter((device) => device.selected)
      .map((device) => device.id);

    if (selectedIds.length === 0) {
      showMessage("Greška", "Nema označenih uređaja.");
      return;
    }

    await fetch(`${baseUrl}/devices/restart`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids: selectedIds }),
    });

    showMessage("Info", "Restart zapocet za oznacene uredaje.");
  };

  const handleApplySettings = async () => {
    const selectedIds = devices
      .filter((device) => device.selected)
      .map((device) => device.id);

    if (selectedIds.length === 0) {
      showMessage("Greška", "Nema označenih uređaja.");
      return;
    }

    await fetch(`${baseUrl}/devices/settings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ids: selectedIds,
        settings: { mode: "professionally managed", updatedAt: new Date() },
      }),
    });

    showMessage("Info", "Promjene poslane za oznacene uredaje.");
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      showMessage("Greška", "Unesite naziv grupe.");
      return;
    }

    await fetch(`${baseUrl}/groups`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: groupName.trim() }),
    });

    setGroupName("");
    loadGroups();
    showMessage("Info", "Grupa je kreirana.");
  };

  const handleRestartGroup = async (groupId: number) => {
    await fetch(`${baseUrl}/groups/${groupId}/restart`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    showMessage("Info", "Restart grupe pokrenut.");
  };

  const handlePowerOnGroup = async (groupId: number) => {
    try {
      const response = await fetch(`${baseUrl}/groups/${groupId}/poweron`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        showMessage(
          "Greška",
          `Nije uspjelo paljenje grupe: ${errorData?.error || response.statusText}`
        );
        return;
      }

      const data = await response.json();
      const count = data.results.filter((item: any) => item.poweredOn).length;
      showMessage("Info", `Poslano paljenje grupe. Uspješno upaljeno ${count} uređaja.`);
      await refreshAll();
    } catch (error) {
      console.error("Greška pri paljenju grupe:", error);
      showMessage("Greška", "Greška pri paljenju grupe.");
    }
  };

  const handleOpenModal = () => {
    setEditingId(null);
    clearModalFields();
    setShowAddForm(true);
  };

  const filteredDevices = devices.filter((device) => {
    const matchesSearch =
      device.name.toLowerCase().includes(search.toLowerCase()) ||
      device.ip.includes(search);

    const matchesGroup =
      groupFilter === null ||
      (groupFilter === -1 ? device.groupId === null : device.groupId === groupFilter);

    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "online" && device.status === "Online") ||
      (statusFilter === "offline" && device.status === "Offline");

    return matchesSearch && matchesGroup && matchesStatus;
  });

  const selectedDevice = devices.find((device) => device.id === selectedDeviceId) || null;
  const selectedDeviceHistory = selectedDevice
    ? deviceHistory[selectedDevice.id] || []
    : [];

  const recentDeviceEvents = Object.entries(deviceHistory)
    .flatMap(([deviceId, entries]) =>
      entries.map((entry) => ({
        deviceId: Number(deviceId),
        ...entry,
        deviceName: devices.find((device) => device.id === Number(deviceId))?.name || `Uređaj ${deviceId}`,
      }))
    )
    .sort((a, b) => b.time - a.time)
    .slice(0, 8);

  const groupStatusSummary = groups.map((group) => {
    const members = devices.filter((device) => device.groupId === group.id);
    const onlineCount = members.filter((device) => device.status === "Online").length;
    return {
      ...group,
      onlineCount,
      offlineCount: members.length - onlineCount,
    };
  });

  const unassignedCount = devices.filter((device) => device.groupId === null).length;
  const groupHealth = groupStatusSummary
    .map((group) => ({
      ...group,
      offlineRatio: group.deviceCount ? group.offlineCount / group.deviceCount : 0,
    }))
    .sort((a, b) => b.offlineRatio - a.offlineRatio)
    .slice(0, 4);

  const recentOfflineEvents = recentDeviceEvents.filter((entry) => entry.status === "Offline").length;
  const dashboardInsights = [
    `Najviše offline ima ${groupHealth[0]?.name || "nijedna grupa"} (${groupHealth[0]?.offlineCount || 0}).`,
    `U mreži je ${unassignedCount} uređaja bez grupe.`,
    `Posljednjih 8 događaja: ${recentOfflineEvents} offline zapisa.`,
  ];

  const onlineCount = devices.filter((device) => device.status === "Online").length;
  const offlineCount = devices.filter((device) => device.status === "Offline").length;
  const selectedCount = devices.filter((device) => device.selected).length;

  const healthScore = devices.length > 0 ? Math.round((onlineCount / devices.length) * 100) : 0;
  const healthStatus = healthScore >= 80 ? "excellent" : healthScore >= 60 ? "good" : healthScore >= 40 ? "warning" : "critical";
  const criticalOfflineDevices = devices.filter((device) => device.status === "Offline").slice(0, 3);
  const hasCritical = offlineCount > 0;

  const formatStatusText = (status: string) => {
    if (status === "Online") return "Na mreži";
    if (status === "Offline") return "Van mreže";
    return status;
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <h2>LG TV Upravljač</h2>
        <div className="sidebar-menu">
          <p className={activePage === "dashboard" ? "active" : ""} onClick={() => setActivePage("dashboard")}>📊 Početna</p>
          <p className={activePage === "devices" ? "active" : ""} onClick={() => setActivePage("devices")}>📺 Uređaji</p>
          <p className={activePage === "groups" ? "active" : ""} onClick={() => setActivePage("groups")}>👥 Grupe</p>
          <p className={activePage === "settings" ? "active" : ""} onClick={() => setActivePage("settings")}>⚙️ Postavke</p>
        </div>
      </aside>

      <main className="content">
        {activePage === "dashboard" && (
          <>
            <h1>Početna</h1>
            <div className="stats">
              <div className="stat-card">
                <div className="stat-number">{devices.length}</div>
                <div>Ukupno uređaja</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{onlineCount}</div>
                <div>Na mreži</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{offlineCount}</div>
                <div>Van mreže</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{groups.length}</div>
                <div>Grupe</div>
              </div>
            </div>

            {hasCritical && (
              <div className={`alarm-notification alarm-${healthStatus}`}>
                <div className="alarm-header">
                  <span className="alarm-icon">⚠️</span>
                  <span className="alarm-title">UPOZORENJE - Kritični uređaji offline</span>
                </div>
                <div className="alarm-devices">
                  {criticalOfflineDevices.map((device) => (
                    <div key={device.id} className="alarm-device-item">
                      <span className="alarm-dot"></span>
                      <span>{device.name}</span>
                      <span className="alarm-ip">({device.ip})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="health-score-card">
              <div className="health-header">
                <h3>Zdravlje mreže</h3>
                <div className={`health-badge health-${healthStatus}`}>
                  {healthScore}%
                </div>
              </div>
              <div className="health-bar">
                <div className="health-bar-fill" style={{ width: `${healthScore}%` }}></div>
              </div>
              <p className="health-text">
                {healthStatus === "excellent" && "Mreža je u odličnom stanju! Svi uređaji su dostupni."}
                {healthStatus === "good" && "Mreža je u dobrom stanju. Većina uređaja je dostupna."}
                {healthStatus === "warning" && "Mreža zahtjeva pažnju. Nekoliko uređaja je van mreže."}
                {healthStatus === "critical" && "Mreža je u kritičnom stanju! Mnogi uređaji su van mreže."}
              </p>
            </div>

            <div className="dashboard-charts">
              <div className="chart-card">
                <div className="chart-title">Uređaji na mreži</div>
                <div className="chart-bar-container">
                  <div
                    className="chart-bar online"
                    style={{
                      width: `${devices.length ? (onlineCount / devices.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div>{onlineCount} / {devices.length}</div>
              </div>
              <div className="chart-card">
                <div className="chart-title">Uređaji van mreže</div>
                <div className="chart-bar-container">
                  <div
                    className="chart-bar offline"
                    style={{
                      width: `${devices.length ? (offlineCount / devices.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div>{offlineCount} / {devices.length}</div>
              </div>
            </div>

            {devices.length > 0 && (
              <div className="pie-chart-container">
                <h2>Distribuacija statusa uređaja</h2>
                <svg className="pie-chart" viewBox="0 0 200 200" style={{ maxWidth: '300px', margin: '20px auto' }}>
                  <circle cx="100" cy="100" r="90" fill="none" stroke="#e2e8f0" strokeWidth="60" />
                  {onlineCount > 0 && (
                    <circle
                      cx="100"
                      cy="100"
                      r="90"
                      fill="none"
                      stroke="#22c55e"
                      strokeWidth="60"
                      strokeDasharray={`${(onlineCount / devices.length) * 565.5} 565.5`}
                      strokeLinecap="round"
                      transform="rotate(-90 100 100)"
                    />
                  )}
                  {offlineCount > 0 && (
                    <circle
                      cx="100"
                      cy="100"
                      r="90"
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="60"
                      strokeDasharray={`${(offlineCount / devices.length) * 565.5} 565.5`}
                      strokeLinecap="round"
                      transform={`rotate(${(onlineCount / devices.length) * 360 - 90} 100 100)`}
                    />
                  )}
                  <text x="100" y="90" textAnchor="middle" fontSize="24" fontWeight="700" fill="#1f2937">
                    {devices.length}
                  </text>
                  <text x="100" y="115" textAnchor="middle" fontSize="14" fill="#4b5563">
                    uređaja
                  </text>
                </svg>
                <div className="pie-legend">
                  <div className="pie-legend-item">
                    <span className="pie-legend-dot online"></span>
                    <span>Na mreži ({onlineCount})</span>
                  </div>
                  <div className="pie-legend-item">
                    <span className="pie-legend-dot offline"></span>
                    <span>Van mreže ({offlineCount})</span>
                  </div>
                </div>
              </div>
            )}

            {groupStatusSummary.length > 0 && (
              <div className="circular-progress-container">
                <h2>Zdravlje grupa po dostupnosti</h2>
                <div className="circular-grid">
                  {groupStatusSummary.slice(0, 4).map((group) => {
                    const healthPercent = group.deviceCount ? (group.onlineCount / group.deviceCount) * 100 : 0;
                    const circumference = 2 * Math.PI * 45;
                    const strokeDashoffset = circumference - (healthPercent / 100) * circumference;
                    return (
                      <div key={group.id} className="circular-progress-card">
                        <svg className="circular-progress" viewBox="0 0 100 100">
                          <circle cx="50" cy="50" r="45" fill="none" stroke="#e2e8f0" strokeWidth="8" />
                          <circle
                            cx="50"
                            cy="50"
                            r="45"
                            fill="none"
                            stroke={healthPercent > 50 ? '#22c55e' : healthPercent > 20 ? '#f59e0b' : '#ef4444'}
                            strokeWidth="8"
                            strokeDasharray={circumference}
                            strokeDashoffset={strokeDashoffset}
                            strokeLinecap="round"
                            transform="rotate(-90 50 50)"
                          />
                          <text x="50" y="50" textAnchor="middle" dy="0.3em" fontSize="20" fontWeight="700" fill="#1f2937">
                            {Math.round(healthPercent)}%
                          </text>
                        </svg>
                        <div className="circular-progress-label">
                          <strong>{group.name}</strong>
                          <small>{group.onlineCount}/{group.deviceCount}</small>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="dashboard-grid">
              <div className="dashboard-panel">
                <h2>Grupe koje trebaju pažnju</h2>
                <p className="form-description">
                  Prati grupe prema udjelu offline uređaja i brzo vidi gdje treba intervenirati.
                </p>
                {groupHealth.length === 0 ? (
                  <p className="empty-log">Nema dovoljno podataka za grupnu analizu.</p>
                ) : (
                  <ul className="group-health-list">
                    {groupHealth.map((group) => (
                      <li key={group.id} className="group-health-item">
                        <div className="group-health-title">
                          <strong>{group.name}</strong>
                          <span>{group.offlineCount}/{group.deviceCount} offline</span>
                        </div>
                        <div className="group-health-bar-container">
                          <div
                            className="group-health-bar"
                            style={{ width: `${group.deviceCount ? (group.offlineRatio * 100).toFixed(0) : 0}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="dashboard-panel">
                <h2>Operativni uvidi</h2>
                <p className="form-description">
                  Kratki pregled najvažnijih stanja i preporuka za akciju.
                </p>
                <ul className="insight-list">
                  {dashboardInsights.map((insight, index) => (
                    <li key={index}>{insight}</li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}

        {activePage === "groups" && (
          <>
            <h1>Grupe uređaja</h1>
            <p className="page-description">
              Grupe služe za organizaciju TV uređaja u logične cjeline.
              Dodaj uređaje u grupu kako bi mogao upravljati cijelom grupom odjednom,
              primjerice restartati sve uređaje u toj grupi.
            </p>
            <div className="group-actions">
              <input
                className="small-input"
                placeholder="Naziv nove grupe"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
              <button type="button" className="add-btn" onClick={handleCreateGroup}>
                Kreiraj grupu
              </button>
            </div>

            <div className="group-list">
              {groupStatusSummary.map((group) => (
                <div className="group-card" key={group.id}>
                  <div className="group-card-title">{group.name}</div>
                  <div>{group.deviceCount} uređaja</div>
                  <div className="group-metrics">
                    <span>Online: {group.onlineCount}</span>
                    <span>Offline: {group.offlineCount}</span>
                  </div>
                  <div className="group-card-actions">
                    <button
                      type="button"
                      className="action-btn restart-btn"
                      onClick={() => handleRestartGroup(group.id)}
                    >
                      Restart grupe
                    </button>
                    <button
                      type="button"
                      className="action-btn poweron-btn"
                      onClick={() => handlePowerOnGroup(group.id)}
                    >
                      Upali grupu
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {activePage === "settings" && (
          <>
            <h1>Postavke</h1>
            <div className="table-wrapper">
              <p>Backend URL:</p>
              <input
                className="small-input"
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value)}
              />
              <br />
              <br />
              <p>Scheduler:</p>
              <select
                className="small-select"
                value={schedulerOn ? "on" : "off"}
                onChange={(e) => setSchedulerOn(e.target.value === "on")}
              >
                <option value="on">Uključen</option>
                <option value="off">Isključen</option>
              </select>
              <br />
              <br />
              <button
                type="button"
                className="save-btn"
                onClick={() => showMessage("Info", "Postavke spremljene lokalno.")}
              >
                Spremi postavke
              </button>
            </div>
          </>
        )}

        {activePage === "devices" && (
          <>
            <div className="top-bar">
              <div>
                <h1>Uređaji</h1>
                <p className="page-description">
                  Pronađi uređaje brzo, upravljaj grupama i primjeni postavke u nekoliko klikova.
                </p>
                <p className="last-refresh">Zadnje osvježenje: {lastRefresh || "još nije osvježeno"}</p>
              </div>
              <div className="top-bar-actions">
                <button type="button" className="refresh-btn" onClick={refreshAll}>
                  Osvježi
                </button>
                <button type="button" className="action-btn poweron-btn" onClick={handlePowerOnAll}>
                  Upali sve TV-e
                </button>
                <button type="button" className="add-btn" onClick={handleOpenModal}>
                  + Dodaj uređaj
                </button>
              </div>
            </div>

            {showAddForm && (
              <div className="add-form-card">
                <h2>{editingId !== null ? "Uredi uređaj" : "Dodaj novi uređaj"}</h2>
                <p className="form-description">
                  Unesi ispravne podatke za TV uređaj. Polja su obavezna i moraju biti u formatu.
                </p>
                <div className="form-grid">
                  <div className="form-field">
                    <input
                      autoFocus
                      value={deviceName}
                      onChange={(e) => setDeviceName(e.target.value)}
                      placeholder="Naziv uređaja, npr. TV Sala"
                    />
                    <small>Naziv uređaja koji će se prikazivati u listi.</small>
                  </div>
                  <div className="form-field">
                    <input
                      value={deviceIp}
                      onChange={(e) => setDeviceIp(e.target.value)}
                      placeholder="IP adresa, npr. 192.168.1.10"
                    />
                    <small>Unesi IP adresu uređaja u lokalnoj mreži.</small>
                  </div>
                  <div className="form-field">
                    <input
                      value={deviceMac}
                      onChange={(e) => setDeviceMac(e.target.value)}
                      placeholder="MAC adresa, npr. AA:BB:CC:DD:EE:FF"
                    />
                    <small>Unesi MAC adresu uređaja u HEX formatu.</small>
                  </div>
                  <div className="form-field">
                    <select
                      value={modalGroupId ?? ""}
                      onChange={(e) =>
                        setModalGroupId(e.target.value ? Number(e.target.value) : null)
                      }
                    >
                      <option value="">Bez grupe</option>
                      {groups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                    <small>Odaberi grupu ako želiš ovaj uređaj vezati uz grupu.</small>
                  </div>
                </div>
                <div className="modal-buttons">
                  <button type="button" className="save-btn" onClick={handleSave}>
                    Sačuvaj
                  </button>
                  <button type="button" onClick={closeAddForm}>
                    Otkaži
                  </button>
                </div>
              </div>
            )}

            {showDeleteConfirm && (
              <div className="modal-overlay">
                <div className="modal">
                  <h2>Potvrda brisanja</h2>
                  <p>Da li želiš obrisati odabrani uređaj?</p>
                  <div className="modal-buttons">
                    <button type="button" className="save-btn" onClick={confirmDelete}>
                      Da, obriši
                    </button>
                    <button type="button" onClick={cancelDelete}>
                      Ne, poništi
                    </button>
                  </div>
                </div>
              </div>
            )}
            {showAssignGroupModal && (
              <div className="modal-overlay">
                <div className="modal">
                  <h2>Dodaj u grupu</h2>
                  <p>Izaberi grupu za označene uređaje:</p>
                  <select
                    value={selectedAssignGroupId ?? ""}
                    onChange={(e) =>
                      setSelectedAssignGroupId(
                        e.target.value ? Number(e.target.value) : null
                      )
                    }
                  >
                    <option value="">Odaberi grupu</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                  <div className="modal-buttons">
                    <button type="button" className="save-btn" onClick={assignGroupToSelected}>
                      Dodaj u grupu
                    </button>
                    <button type="button" onClick={cancelAssignGroup}>
                      Otkaži
                    </button>
                  </div>
                </div>
              </div>
            )}

            {messageModal && (
              <div className="modal-overlay">
                <div className="modal">
                  <h2>{messageModal.title}</h2>
                  <p>{messageModal.message}</p>
                  <div className="modal-buttons">
                    {messageModal.onConfirm ? (
                      <>
                        <button type="button" onClick={closeMessageModal}>
                          {messageModal.cancelText || "Odustani"}
                        </button>
                        <button type="button" className="save-btn" onClick={handleMessageConfirm}>
                          {messageModal.confirmText || "Potvrdi"}
                        </button>
                      </>
                    ) : (
                      <button type="button" className="save-btn" onClick={closeMessageModal}>
                        U redu
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="stats">
              <div className="stat-card">
                <div className="stat-number">{devices.length}</div>
                <div>Ukupno uređaja</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{onlineCount}</div>
                <div>Na mreži</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{offlineCount}</div>
                <div>Van mreže</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{selectedCount}</div>
                <div>Odabrano</div>
              </div>
            </div>

            <div className="activity-feed-card">
              <h2>Aktivnosti uređaja</h2>
              <p className="form-description">
                Prati posljednjih 8 automatskih i manuelnih događaja za uređaje.
              </p>
              {recentDeviceEvents.length === 0 ? (
                <p className="empty-log">Nema zabilježenih aktivnosti još.</p>
              ) : (
                <ul className="activity-log">
                  {recentDeviceEvents.map((entry) => (
                    <li key={`${entry.deviceId}-${entry.time}`}>
                      <strong>{entry.timestamp}</strong> - <span>{entry.deviceName}</span> - {entry.status} - {entry.note}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <input
              className="search-box"
              placeholder="Pretraži uređaj..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <div className="filters">
              <select
                className="small-select select-box"
                value={groupFilter ?? ""}
                onChange={(e) =>
                  setGroupFilter(e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">Sve grupe</option>
                <option value="-1">Bez grupe</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <select
                className="small-select select-box"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">Sve statusi</option>
                <option value="online">Samo online</option>
                <option value="offline">Samo offline</option>
              </select>
              {selectedDevice && (
                <button
                  type="button"
                  className="action-btn"
                  onClick={handleClearSelection}
                >
                  Zatvori detalje
                </button>
              )}
            </div>

            <div className="actions">
              <button type="button" className="action-btn restart-btn" onClick={handleRestartSelected}>
                Restart označenih
              </button>
              <button type="button" className="action-btn settings-btn" onClick={handleApplySettings}>
                Pošalji postavke
              </button>
              <button type="button" className="action-btn delete-selected-btn" onClick={handleDeleteSelected}>
                Obriši odabrane
              </button>
              <button type="button" className="action-btn assign-btn" onClick={openAssignGroupModal}>
                Dodaj u grupu
              </button>
            </div>

            <div className="table-wrapper">
              <table className="device-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Naziv</th>
                    <th>IP Adresa</th>
                    <th>MAC Adresa</th>
                    <th>Grupa</th>
                    <th>Status</th>
                    <th>Akcije</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredDevices.length === 0 ? (
                    <tr className="empty-row">
                      <td colSpan={7}>
                        Nema uređaja za prikaz. Dodaj novi uređaj ili očisti pretragu.
                      </td>
                    </tr>
                  ) : (
                    filteredDevices.map((device) => (
                      <tr key={device.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={device.selected}
                            onChange={() => toggleDevice(device.id)}
                          />
                        </td>
                        <td>{device.name}</td>
                        <td>{device.ip}</td>
                        <td>{device.mac}</td>
                        <td>{device.groupName || "-"}</td>
                        <td>
                          <span
                            className={
                              device.status === "Online"
                                ? "status-online"
                                : "status-offline"
                            }
                          >
                            {device.status === "Online" ? "🟢" : "🔴"} {formatStatusText(device.status)}
                          </span>
                        </td>
                        <td>
                          <div className="action-buttons-row">
                            <button
                              type="button"
                              className="view-btn"
                              onClick={() => handleViewDevice(device.id)}
                            >
                              Pogledaj
                            </button>
                            <button
                              type="button"
                              className="edit-btn"
                              onClick={() => {
                                setEditingId(device.id);
                                setDeviceName(device.name);
                                setDeviceIp(device.ip);
                                setDeviceMac(device.mac);
                                setModalGroupId(device.groupId ?? null);
                                setShowAddForm(true);
                              }}
                            >
                              Uredi
                            </button>
                            <button
                              type="button"
                              className="delete-btn"
                              onClick={() => {
                                setPendingDelete(device.id);
                                setShowDeleteConfirm(true);
                              }}
                            >
                              Obriši
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {selectedDevice && (
              <div className="device-details-card">
                <h2>Detalji uređaja</h2>
                <p className="form-description">
                  Brzi pregled statusa, grupe i zapisa posljednjih automatskih provjera.
                </p>
                <div className="detail-row">
                  <span>Naziv:</span>
                  <strong>{selectedDevice.name}</strong>
                </div>
                <div className="detail-row">
                  <span>IP adresa:</span>
                  <strong>{selectedDevice.ip}</strong>
                </div>
                <div className="detail-row">
                  <span>MAC adresa:</span>
                  <strong>{selectedDevice.mac}</strong>
                </div>
                <div className="detail-row">
                  <span>Grupa:</span>
                  <strong>{selectedDevice.groupName || "Bez grupe"}</strong>
                </div>
                <div className="detail-row">
                  <span>Status:</span>
                  <strong>{formatStatusText(selectedDevice.status)}</strong>
                </div>
                <div className="history-section">
                  <h3>Posljednji zapisi</h3>
                  <ul>
                    {selectedDeviceHistory.length === 0 ? (
                      <li>Nema zapisa za ovaj uređaj.</li>
                    ) : (
                      selectedDeviceHistory.map((entry, index) => (
                        <li key={`${selectedDevice.id}-${index}`}>
                          <strong>{entry.timestamp}</strong> - {entry.status} - {entry.note}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>{editingId !== null ? "Uredi uredaj" : "Dodaj uredaj"}</h2>

            <input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="Naziv uređaja"
            />
            <input
              value={deviceIp}
              onChange={(e) => setDeviceIp(e.target.value)}
              placeholder="IP adresa"
            />
            <input
              value={deviceMac}
              onChange={(e) => setDeviceMac(e.target.value)}
              placeholder="MAC adresa"
            />
            <select
              value={modalGroupId ?? ""}
              onChange={(e) =>
                setModalGroupId(
                  e.target.value ? Number(e.target.value) : null
                )
              }
            >
              <option value="">Bez grupe</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>

            <div className="modal-buttons">
              <button type="button" onClick={() => setShowModal(false)}>Otkaži</button>
              <button type="button" className="save-btn" onClick={handleSave}>
                Sacuvaj
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && <div className="loading-overlay">Osvježavanje...</div>}
      {statusMessage && <div className="status-message">{statusMessage}</div>}
    </div>
  );
}

export default App;
