import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import { collection, getDocs } from 'firebase/firestore';

export default function GroupRequestModal({
  groupingEntry,        // { batchId, id }
  newBatchId,
  setNewBatchId,
  setGroupingEntry,
  handleAssignToBatch,
  dropdownStyle
}) {
  const [batchOptions, setBatchOptions] = useState([]);

  useEffect(() => {
    const fetchBatches = async () => {
      const snap = await getDocs(collection(db, 'customerServiceTracking'));
      const openBatches = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(b => b.status !== 'Finished' && b.status !== 'complete');
      setBatchOptions(openBatches);
    };
    fetchBatches();
  }, []);

  if (!groupingEntry) return null;

  const handleAssign = () => {
    if (!newBatchId) return;
    handleAssignToBatch(groupingEntry.batchId, groupingEntry.id, newBatchId);
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0,
      width: '100%', height: '100%',
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#fff',
        padding: '20px',
        borderRadius: '12px',
        width: '400px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
      }}>
        <h3>Group Request</h3>
        <p>Select or create a batch ID to group this request.</p>

        <label>Existing Batch IDs:</label>
        <select
          style={dropdownStyle}
          value={newBatchId}
          onChange={(e) => setNewBatchId(e.target.value)}
        >
          <option value="">-- Select Batch --</option>
          {batchOptions.map(b => (
            <option key={b.id} value={b.id}>
              {b.billingBatchId || b.id}
            </option>
          ))}
        </select>

        <label style={{ marginTop: '10px' }}>Or New Batch ID:</label>
        <input
          type="text"
          placeholder="Enter new batch ID"
          value={newBatchId}
          onChange={(e) => setNewBatchId(e.target.value)}
          style={{ width: '100%', marginBottom: '10px' }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button onClick={() => setGroupingEntry(null)} style={{ padding: '8px 14px' }}>Cancel</button>
          <button
            onClick={handleAssign}
            style={{ padding: '8px 14px', backgroundColor: '#0077cc', color: 'white', borderRadius: '6px' }}
          >
            Assign
          </button>
        </div>
      </div>
    </div>
  );
}
