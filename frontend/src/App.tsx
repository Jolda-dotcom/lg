import { useState } from "react";
import "./App.css";

function App() {
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");

  const [deviceName, setDeviceName] = useState("");
  const [deviceIp, setDeviceIp] = useState("");
  const [deviceMac, setDeviceMac] = useState("");

  const [devices, setDevices] = useState([
    {
      id: 1,
      name: "TV Sala",
      ip: "192.168.1.10",
      mac: "AA:BB:CC:DD:EE:01",
      status: "Online",
      selected: false,
    },
    {
      id: 2,
      name: "TV Lobby",
      ip: "192.168.1.11",
      mac: "AA:BB:CC:DD:EE:02",
      status: "Offline",
      selected: false,
    },
  ]);

  const handleSave = () => {
    if (!deviceName || !deviceIp || !deviceMac) {
      alert("Popuni sva polja");
      return;
    }

    const newDevice = {
      id: Date.now(),
      name: deviceName,
      ip: deviceIp,
      mac: deviceMac,
      status: "Online",
      selected: false,
    };

    setDevices([...devices, newDevice]);

    setDeviceName("");
    setDeviceIp("");
    setDeviceMac("");

    setShowModal(false);
  };

  const handleDelete = (id: number) => {
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

  const deleteSelected = () => {
    setDevices(devices.filter((device) => !device.selected));
  };

  const filteredDevices = devices.filter(
    (device) =>
      device.name.toLowerCase().includes(search.toLowerCase()) ||
      device.ip.includes(search)
  );

  const onlineCount = devices.filter(
    (device) => device.status === "Online"
  ).length;

  const offlineCount = devices.filter(
    (device) => device.status === "Offline"
  ).length;

  const selectedCount = devices.filter(
    (device) => device.selected
  ).length;

  return (
    <div className="app">
      <aside className="sidebar">
        <h2>LG TV Manager</h2>

        <div className="sidebar-menu">
          <p>📊 Dashboard</p>
          <p>📺 Uređaji</p>
          <p>👥 Grupe</p>
          <p>⚙️ Postavke</p>
        </div>
      </aside>

      <main className="content">
        <div className="top-bar">
          <h1>Uređaji</h1>

          <button
            className="add-btn"
            onClick={() => setShowModal(true)}
          >
            + Dodaj uređaj
          </button>
        </div>

        <div className="stats">
          <div className="stat-card">
            <div className="stat-number">{devices.length}</div>
            <div>Ukupno uređaja</div>
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
          <button
            className="action-btn restart-btn"
            onClick={() => alert("Restart odabranih TV uređaja")}
          >
            Restart odabranih
          </button>

          <button
            className="action-btn settings-btn"
            onClick={() => alert("Slanje postavki")}
          >
            Pošalji postavke
          </button>

          <button
            className="action-btn delete-selected-btn"
            onClick={deleteSelected}
          >
            Obriši odabrane
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

                  <td>
                    {device.status === "Online"
                      ? "🟢 Online"
                      : "🔴 Offline"}
                  </td>

                  <td>
                    <button className="edit-btn">
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
      </main>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Dodaj uređaj</h2>

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

            <div className="modal-buttons">
              <button onClick={() => setShowModal(false)}>
                Otkaži
              </button>

              <button
                className="save-btn"
                onClick={handleSave}
              >
                Sačuvaj
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;