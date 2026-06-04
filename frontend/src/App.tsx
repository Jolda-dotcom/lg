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

function App() {
  const [activePage, setActivePage] = useState("devices");
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [deviceIp, setDeviceIp] = useState("");
  const [deviceMac, setDeviceMac] = useState("");
  const [modalGroupId, setModalGroupId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupName, setGroupName] = useState("");
  const [assignGroupId, setAssignGroupId] = useState<number | null>(null);
  const [backendUrl, setBackendUrl] = useState("http://localhost:5000");
  const [schedulerOn, setSchedulerOn] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const baseUrl = backendUrl.replace(/\/$/, "");

  useEffect(() => {
    refreshAll();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshAll();
    }, 30000);

    return () => clearInterval(interval);
  }, [backendUrl]);

  const refreshAll = async () => {
    setLoading(true);
    await Promise.all([loadDevices(), loadGroups()]);
    setLoading(false);
    setStatusMessage("Status osvježen");
    setTimeout(() => setStatusMessage(""), 2000);
  };

  const loadDevices = async () => {
    try {
      const response = await fetch(`${baseUrl}/devices`);
      const data = await response.json();
      setDevices(
        data.map((device: any) => ({
          ...device,
          selected: false,
        }))
      );
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

  const clearModalFields = () => {
    setDeviceName("");
    setDeviceIp("");
    setDeviceMac("");
    setModalGroupId(null);
  };

  const handleSave = async () => {
    if (!deviceName || !deviceIp || !deviceMac) {
      alert("Popuni sva polja");
      return;
    }

    const payload = {
      name: deviceName,
      ip: deviceIp,
      mac: deviceMac,
      groupId: modalGroupId,
    };

    if (editingId !== null) {
      await fetch(`${baseUrl}/devices/${editingId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

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
    setShowModal(false);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Obrisati uređaj?")) {
      return;
    }

    await fetch(`${baseUrl}/devices/${id}`, {
      method: "DELETE",
    });

    setDevices(devices.filter((device) => device.id !== id));
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

  const handleDeleteSelected = async () => {
    const selectedDevices = devices.filter((device) => device.selected);

    if (selectedDevices.length === 0) {
      return;
    }

    if (!window.confirm("Obrisati označene uređaje?")) {
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

  const handleRestartSelected = async () => {
    const selectedIds = devices
      .filter((device) => device.selected)
      .map((device) => device.id);

    if (selectedIds.length === 0) {
      alert("Nema oznacenih uredaja.");
      return;
    }

    await fetch(`${baseUrl}/devices/restart`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids: selectedIds }),
    });

    alert("Restart zapocet za oznacene uredaje.");
  };

  const handleApplySettings = async () => {
    const selectedIds = devices
      .filter((device) => device.selected)
      .map((device) => device.id);

    if (selectedIds.length === 0) {
      alert("Nema oznacenih uredaja.");
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

    alert("Promjene poslane za oznacene uredaje.");
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      alert("Unesite naziv grupe.");
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
  };

  const handleAssignSelectedToGroup = async () => {
    const selectedIds = devices
      .filter((device) => device.selected)
      .map((device) => device.id);

    if (selectedIds.length === 0 || assignGroupId === null) {
      alert("Odaberite grupu i oznacite uredaje.");
      return;
    }

    await fetch(`${baseUrl}/groups/${assignGroupId}/devices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ deviceIds: selectedIds }),
    });

    await refreshAll();
    alert("Oznaceni uredaji dodani u grupu.");
  };

  const handleRestartGroup = async (groupId: number) => {
    await fetch(`${baseUrl}/groups/${groupId}/restart`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    alert("Restart grupe pokrenut.");
  };

  const handleOpenModal = () => {
    setEditingId(null);
    clearModalFields();
    setShowModal(true);
  };

  const filteredDevices = devices.filter(
    (device) =>
      device.name.toLowerCase().includes(search.toLowerCase()) ||
      device.ip.includes(search)
  );

  const onlineCount = devices.filter((device) => device.status === "Online").length;
  const offlineCount = devices.filter((device) => device.status === "Offline").length;
  const selectedCount = devices.filter((device) => device.selected).length;

  return (
    <div className="app">
      <aside className="sidebar">
        <h2>LG TV Manager</h2>
        <div className="sidebar-menu">
          <p onClick={() => setActivePage("dashboard")}>📊 Dashboard</p>
          <p onClick={() => setActivePage("devices")}>📺 Uređaji</p>
          <p onClick={() => setActivePage("groups")}>👥 Grupe</p>
          <p onClick={() => setActivePage("settings")}>⚙️ Postavke</p>
        </div>
      </aside>

      <main className="content">
        {activePage === "dashboard" && (
          <>
            <h1>Dashboard</h1>
            <div className="stats">
              <div className="stat-card">
                <div className="stat-number">{devices.length}</div>
                <div>Ukupno uredaja</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{onlineCount}</div>
                <div>Online</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{offlineCount}</div>
                <div>Offline</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{groups.length}</div>
                <div>Grupe</div>
              </div>
            </div>

            <div className="dashboard-charts">
              <div className="chart-card">
                <div className="chart-title">Online uredaji</div>
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
                <div className="chart-title">Offline uredaji</div>
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
          </>
        )}

        {activePage === "groups" && (
          <>
            <h1>Grupe uredaja</h1>
            <div className="group-actions">
              <input
                placeholder="Naziv nove grupe"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
              <button className="add-btn" onClick={handleCreateGroup}>
                Kreiraj grupu
              </button>
            </div>

            <div className="group-list">
              {groups.map((group) => (
                <div className="group-card" key={group.id}>
                  <div className="group-card-title">{group.name}</div>
                  <div>{group.deviceCount} uredaja</div>
                  <button
                    className="action-btn restart-btn"
                    onClick={() => handleRestartGroup(group.id)}
                  >
                    Restart grupe
                  </button>
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
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value)}
              />
              <br />
              <br />
              <p>Scheduler:</p>
              <select
                value={schedulerOn ? "on" : "off"}
                onChange={(e) => setSchedulerOn(e.target.value === "on")}
              >
                <option value="on">Uključen</option>
                <option value="off">Isključen</option>
              </select>
              <br />
              <br />
              <button
                className="save-btn"
                onClick={() => alert("Postavke spremljene lokalno.")}
              >
                Spremi postavke
              </button>
            </div>
          </>
        )}

        {activePage === "devices" && (
          <>
            <div className="top-bar">
              <h1>Uredaji</h1>
              <button className="add-btn" onClick={handleOpenModal}>
                + Dodaj uredaj
              </button>
            </div>

            <div className="stats">
              <div className="stat-card">
                <div className="stat-number">{devices.length}</div>
                <div>Ukupno uredaja</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{onlineCount}</div>
                <div>Online</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{offlineCount}</div>
                <div>Offline</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{selectedCount}</div>
                <div>Odabrano</div>
              </div>
            </div>

            <input
              className="search-box"
              placeholder="Pretraži uređaj..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <div className="actions">
              <button className="action-btn restart-btn" onClick={handleRestartSelected}>
                Restart oznacenih
              </button>
              <button className="action-btn settings-btn" onClick={handleApplySettings}>
                Pošalji postavke
              </button>
              <button className="action-btn delete-selected-btn" onClick={handleDeleteSelected}>
                Obriši odabrane
              </button>
              <select
                className="select-box"
                value={assignGroupId ?? ""}
                onChange={(e) =>
                  setAssignGroupId(
                    e.target.value ? Number(e.target.value) : null
                  )
                }
              >
                <option value="">Dodijeli grupu</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <button className="action-btn assign-btn" onClick={handleAssignSelectedToGroup}>
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
                  {filteredDevices.map((device) => (
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
                          {device.status === "Online" ? "🟢" : "🔴"}
                          {" "}
                          {device.status}
                        </span>
                      </td>
                      <td>
                        <button
                          className="edit-btn"
                          onClick={() => {
                            setEditingId(device.id);
                            setDeviceName(device.name);
                            setDeviceIp(device.ip);
                            setDeviceMac(device.mac);
                            setModalGroupId(device.groupId ?? null);
                            setShowModal(true);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="delete-btn"
                          onClick={() => handleDelete(device.id)}
                        >
                          Obriši
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
              placeholder="Naziv uredaja"
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
              <button onClick={() => setShowModal(false)}>Otkaži</button>
              <button className="save-btn" onClick={handleSave}>
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
