import React, { useState, useEffect } from 'react';
import TireSingleRequest from './TireSingleRequest';
import TireGroupedRequest from './TireGroupedRequest';
import ServiceDropdowns from './ServiceDropdowns';
import EditServiceModal from './EditServiceModal';
import GroupRequestModal from './GroupRequestModal';
import { db, storage } from '../firebase';
import { collection, getDocs, updateDoc, doc, deleteDoc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import imageCompression from 'browser-image-compression';

export default function TireServiceCard({ role }) {
  const [entries, setEntries] = useState([]);
  const [expandedBatch, setExpandedBatch] = useState(null);
  const [mode, setMode] = useState('single');
  const [editingEntry, setEditingEntry] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [groupingEntry, setGroupingEntry] = useState(null);
  const [newBatchId, setNewBatchId] = useState('');
  const [showApproveAction, setShowApproveAction] = useState(false);

  const [selectedPurchaseFile, setSelectedPurchaseFile] = useState(null);
  const [selectedProformaFile, setSelectedProformaFile] = useState(null);

  useEffect(() => {
    const flashStyle = `
      @keyframes flash {
        0% { opacity: 1; }
        50% { opacity: 0.4; }
        100% { opacity: 1; }
      }
    `;
    const styleTag = document.createElement('style');
    styleTag.innerHTML = flashStyle;
    document.head.appendChild(styleTag);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setShowApproveAction(prev => !prev);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const fetchEntries = async () => {
    try {
      const batchSnap = await getDocs(collection(db, 'customerServiceTracking'));
      const batches = [];

      for (const batchDoc of batchSnap.docs) {
        const batchId = batchDoc.id;
        const batchData = batchDoc.data();

        const requestsSnap = await getDocs(collection(db, `customerServiceTracking/${batchId}/requests`));
        const requests = requestsSnap.docs.map(r => ({
          id: r.id,
          ...r.data()
        }));

        batches.push({
          batchId,
          billingBatchId: batchData.billingBatchId || batchId,
          ...batchData,
          requests
        });
      }

      setEntries(batches);
    } catch (err) {
      console.error('Fetch failed:', err);
    }
  };

  useEffect(() => { fetchEntries(); }, []);

  // ✅ This was missing before
  const handleUpdateStatus = async (batchId, requestId, status) => {
    if (!status) return;
    try {
      await updateDoc(doc(db, `customerServiceTracking/${batchId}/requests`, requestId), {
        scmApproval: status
      });
      fetchEntries();
    } catch (err) {
      console.error('Update failed:', err);
    }
  };

  const handleManageAction = async (batchId, requestId, action) => {
    try {
      if (action === 'edit') {
        const batch = entries.find(b => b.batchId === batchId);
        const entry = batch.requests.find(r => r.id === requestId);
        setEditingEntry(entry);
        setEditForm({
          plate: entry.plate || '',
          driverName: entry.driverName || '',
          serviceProvider: entry.serviceProvider || '',
          billingBatchId: batch.billingBatchId || 'UNASSIGNED',
        });
      } else if (action === 'delete') {
        await deleteDoc(doc(db, `customerServiceTracking/${batchId}/requests`, requestId));
        fetchEntries();
      } else if (action === 'group') {
        setGroupingEntry({ batchId, id: requestId });
      }
    } catch (err) {
      console.error('Manage action failed:', err);
    }
  };

  const handleAssignToBatch = async (oldBatchId, requestId, newBatchId) => {
  if (!newBatchId) return;

  // Step 1: Confirm before transfer
  const confirmed = window.confirm(
    `Do you want to transfer request ${requestId} from batch ${oldBatchId} to ${newBatchId}?`
  );
  if (!confirmed) return;

  try {
    // Step 2: Get old request
    const oldRef = doc(db, `customerServiceTracking/${oldBatchId}/requests`, requestId);
    const snap = await getDoc(oldRef);
    if (!snap.exists()) {
      alert("❌ Request not found, transfer aborted.");
      return;
    }
    const requestData = snap.data();

    // Step 3: Ensure new batch doc exists
    const newBatchRef = doc(db, "customerServiceTracking", newBatchId);
    const newBatchSnap = await getDoc(newBatchRef);
    if (!newBatchSnap.exists()) {
      await setDoc(newBatchRef, {
        billingBatchId: newBatchId,
        batchComplete: false,
        createdAt: new Date(),
        emailSent: false,
      });
    }

        const newRequestRef = doc(collection(db, `customerServiceTracking/${newBatchId}/requests`));
    await setDoc(newRequestRef, {
      ...requestData,
      billingBatchId: newBatchId,
      timestamp: new Date(),
    });

    // Step 5: Delete old request
    await deleteDoc(oldRef);

    // Step 6: Reset state + refresh
    setGroupingEntry(null);
    setNewBatchId('');
    fetchEntries();

    // Step 7: Confirm success
    alert(`✅ Request ${requestId} successfully moved to batch ${newBatchId}`);
  } catch (err) {
    console.error('Assign to batch failed:', err);
    alert("❌ Transfer failed, check console for details.");
  }
};

  const handleAskFinalApproval = async (batchId) => {
    try {
      await updateDoc(doc(db, "customerServiceTracking", batchId), {
        scmFinalApproval: true,
        finalApproval: false,
        status: "WaitingFinalApproval"
      });
      fetchEntries();
      alert(`Batch ${batchId} is now waiting for Final Approval.`);
    } catch (err) {
      console.error("Final approval request failed:", err);
    }
  };

 const handleFinalApproval = async (batchId, approved) => {
  try {
    // Step 1: Update the batch doc
    await updateDoc(doc(db, "customerServiceTracking", batchId), {
      finalApproval: approved,
      status: approved ? "Finished" : "Rejected",
      closedDate: new Date(),
      completed: approved ? true : false
    });

    // Step 2: Cascade update to all requests inside the batch
    const requestsSnap = await getDocs(collection(db, `customerServiceTracking/${batchId}/requests`));
    for (const req of requestsSnap.docs) {
      await updateDoc(doc(db, `customerServiceTracking/${batchId}/requests`, req.id), {
        finalApproval: approved,
        status: approved ? "Finished" : "Rejected",
        closedDate: new Date()
      });
    }

    // Step 3: Refresh + notify
    fetchEntries();
    alert(`✅ Batch ${batchId} and all its requests have been ${approved ? "Final Approved & Completed" : "Rejected"}.`);
  } catch (err) {
    console.error("Final approval failed:", err);
    alert("❌ Final approval failed, check console for details.");
  }
};

  const handleScmApproveBatch = async (batchId) => {
    try {
      const requestsSnap = await getDocs(collection(db, `customerServiceTracking/${batchId}/requests`));
      for (const req of requestsSnap.docs) {
        await updateDoc(doc(db, `customerServiceTracking/${batchId}/requests`, req.id), {
          scmApproval: "approved"
        });
      }
      fetchEntries();
      alert(`✅ All requests in batch ${batchId} approved by SCM.`);
    } catch (err) {
      console.error("SCM batch approval failed:", err);
    }
  };

  async function uploadCompressedFile(file, folder, batchId, fieldName) {
    let uploadFile = file;
    if (file.type.startsWith("image/")) {
      const options = { maxSizeMB: 1, maxWidthOrHeight: 1920 };
      uploadFile = await imageCompression(file, options);
    }
    const storageRef = ref(storage, `${folder}/${Date.now()}_${uploadFile.name}`);
    await uploadBytes(storageRef, uploadFile);
    const url = await getDownloadURL(storageRef);
    await updateDoc(doc(db, "customerServiceTracking", batchId), { [fieldName]: url });
    alert(`✅ File uploaded successfully: ${uploadFile.name}`);
    return url;
  }

  const dropdownStyle = {
    borderRadius: '8px',
    padding: '6px 12px',
    border: '1px solid #ccc',
    backgroundColor: '#f9fafb',
    fontWeight: '500',
    marginTop: '8px',
  };

  return (
    <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', marginBottom: '24px' }}>
      <h3 style={{ marginBottom: '20px', color: '#0077cc' }}>🛞 Tire Service Tracking</h3>

      <div style={{ marginBottom: '20px' }}>
        <button onClick={() => setMode('single')} style={{ borderRadius: '20px', padding: '10px 18px', marginRight: '12px', backgroundColor: mode === 'single' ? '#0077cc' : '#e0e0e0', color: mode === 'single' ? 'white' : '#333' }}>
          ➕ Single Tire Request
        </button>
        <button onClick={() => setMode('group')} style={{ borderRadius: '20px', padding: '10px 18px', backgroundColor: mode === 'group' ? '#0077cc' : '#e0e0e0', color: mode === 'group' ? 'white' : '#333' }}>
          📦 Grouped by Billing
        </button>
      </div>

      {mode === 'single' && <TireSingleRequest onSaved={fetchEntries} role={role} />}
      {mode === 'group' && <TireGroupedRequest onSaved={fetchEntries} role={role} />}

      <h4 style={{ marginTop: '30px', marginBottom: '16px', color: '#444' }}>📋 Tire Requests Grouped by Billing ID</h4>
      {entries.map(batch => {
  const isExpanded = expandedBatch === batch.batchId;
  const pendingCount = batch.requests.filter(r => r.scmApproval?.toLowerCase() === 'pending').length;
  const allScmApproved = batch.requests.every(r => r.scmApproval?.toLowerCase() === 'approved');
  const batchWaitingFinalApproval = batch.status === "WaitingFinalApproval";
  const hasRequiredFiles = batch.purchaseFileUrl && batch.proformaFileUrl;

  return (
    <div key={batch.batchId} style={{ marginBottom: '20px' }}>
      <div
        onClick={() => setExpandedBatch(isExpanded ? null : batch.batchId)}
        style={{
          backgroundColor: isExpanded ? '#0077cc' : '#f9fafb',
          color: isExpanded ? 'white' : '#333',
          padding: '12px',
          borderRadius: '8px',
          cursor: 'pointer',
          fontWeight: '600',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <span>
          {isExpanded ? '▼' : '▶'} Billing Batch: {batch.billingBatchId} ({batch.requests.length} services)
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Pending SCM approvals badge */}
          {pendingCount > 0 && (
            <span style={{
              backgroundColor: '#ffcccc',
              color: '#b71c1c',
              padding: '3px 50px',
              borderRadius: '12px',
              fontWeight: 'bold',
              animation: 'flash 1s infinite'
            }}>
              ⏳ {pendingCount} waiting SCM approval
            </span>
          )}

          {/* SCM Approve All button */}
          {role?.toLowerCase() === "scm" && pendingCount > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); handleScmApproveBatch(batch.batchId); }}
              style={{ background: '#0077cc', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
            >
              ✅ Approve All Requests
            </button>
          )}

          {/* SCM Ask for Final Approval button */}
          {role?.toLowerCase() === "scm" && allScmApproved && !batchWaitingFinalApproval && hasRequiredFiles && (
            <button
              onClick={(e) => { e.stopPropagation(); handleAskFinalApproval(batch.batchId); }}
              style={{ background: '#ff9800', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
            >
              Ask for Final Approval
            </button>
          )}

          {/* Waiting Final Approval badge */}
          {batchWaitingFinalApproval && (
            <span style={{
              backgroundColor: '#fff3cd',
              color: '#856404',
              padding: '3px 50px',
              borderRadius: '12px',
              fontWeight: 'bold',
              animation: 'flash 1s infinite'
            }}>
              ⏳ Waiting Final Approval
            </span>
          )}

          {/* Approval role buttons */}
          {role?.toLowerCase() === "approval" && batchWaitingFinalApproval && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); handleFinalApproval(batch.batchId, true); }}
                style={{ background: '#4caf50', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
              >
                ✅ Final Approve
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleFinalApproval(batch.batchId, false); }}
                style={{ background: '#f44336', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
              >
                ❌ Reject
              </button>
            </>
          )}
        </div>
      </div>

      {isExpanded && (
        <div style={{ padding: '12px', marginTop: '8px', backgroundColor: '#fcfcfc', borderRadius: '8px' }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {batch.requests.map(entry => (
              <li key={entry.id} style={{
                border: '1px solid #eee',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '10px',
                backgroundColor: '#fff'
              }}>
                <strong>Plate:</strong> {entry.plate || 'N/A'} <br />
                <strong>Driver:</strong> {entry.driverName || 'N/A'} <br />
                <strong>Service Provider:</strong> {entry.serviceProvider || 'N/A'} <br />
                <strong>Billing Batch ID:</strong> {batch.billingBatchId || 'UNASSIGNED'} <br />
                <strong>SCM Approval:</strong> {entry.scmApproval || 'N/A'} <br />
                <strong>Status:</strong> {entry.status || 'N/A'}

                <ServiceDropdowns
                  entry={entry}
                  role={role}
                  dropdownStyle={dropdownStyle}
                  handleUpdateStatus={handleUpdateStatus}
                  handleManageAction={handleManageAction}
                  fetchEntries={fetchEntries}
                  batchId={batch.batchId}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
})}


       <EditServiceModal
        editingEntry={editingEntry}
        editForm={editForm}
        setEditForm={setEditForm}
        setEditingEntry={setEditingEntry}
        fetchEntries={fetchEntries}
      />

      <GroupRequestModal
        groupingEntry={groupingEntry}
        groupedEntries={entries}
        newBatchId={newBatchId}
        setNewBatchId={setNewBatchId}
        setGroupingEntry={setGroupingEntry}
        handleAssignToBatch={handleAssignToBatch}
        dropdownStyle={dropdownStyle}
      />
    </div>
  );
}
