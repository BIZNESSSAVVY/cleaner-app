/* main.js
  - Replace firebaseConfig with your firebase credentials
  - This file uses Firestore (compat SDK) for simplicity and real-time listeners
*/

/* =========================
   FIREBASE CONFIG - EDIT
   ========================= */
const firebaseConfig = {
  apiKey: "AIzaSyDJ--UD2GuGvkW_7peLPkokVYW9UP3L_Do",
  authDomain: "cleaning-scheduler-562a5.firebaseapp.com",
  projectId: "cleaning-scheduler-562a5",
  storageBucket: "cleaning-scheduler-562a5.firebasestorage.app",
  messagingSenderId: "749989640123",
  appId: "1:749989640123:web:34bb934325f8317894b69e",
  measurementId: "G-Q5M4MDD16M"
};


// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

/* ===============
   AUTH (commented)
   ===============
   Below is an example of Email/Password auth you'll enable later.
   It's commented so testing is frictionless.
*/

/*
function signUp(email, password) {
  auth.createUserWithEmailAndPassword(email, password)
    .then(userCred => console.log('Signed up', userCred.user.uid))
    .catch(err => console.error(err));
}

function signIn(email, password) {
  auth.signInWithEmailAndPassword(email, password)
    .then(userCred => console.log('Signed in', userCred.user.uid))
    .catch(err => console.error(err));
}
*/

/////////////////////////
// App variables
/////////////////////////
let cleanerId = null;      // document id in 'cleaners' collection
let cleanerName = null;
let cleanerDocRef = null;
let map, marker;

/* UI refs */
const loginPanel = document.getElementById('loginPanel');
const inputName = document.getElementById('inputName');
const btnBypass = document.getElementById('btnBypass');
const btnUseAuth = document.getElementById('btnUseAuth');

const appPanel = document.getElementById('app');
const cleanerNameEl = document.getElementById('cleanerName');
const selectStatus = document.getElementById('selectStatus');
const btnShareLocation = document.getElementById('btnShareLocation');
const lastLocationEl = document.getElementById('lastLocation');
const jobsList = document.getElementById('jobsList');

/* Helper: create or update cleaner doc in Firestore */
async function upsertCleaner(id, payload) {
  cleanerDocRef = db.collection('cleaners').doc(id);
  await cleanerDocRef.set(payload, { merge: true });
}

/* Initialize Leaflet map (center default) */
function initMap() {
  map = L.map('map', { zoomControl: false }).setView([39.5, -98.35], 4); // USA default
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(map);
}

/* Update local map marker for this cleaner */
function updateLocalMarker(lat, lng) {
  if (!map) initMap();
  if (marker) {
    marker.setLatLng([lat, lng]);
  } else {
    marker = L.marker([lat, lng]).addTo(map);
  }
  map.setView([lat, lng], 14);
}

/* Listen to approved jobs collection and render them */
function listenApprovedJobs() {
  // collection: 'jobs' where approved === true
  return db.collection('jobs').where('approved', '==', true)
    .onSnapshot(snapshot => {
      jobsList.innerHTML = '';
      if (snapshot.empty) {
        jobsList.innerHTML = `<div class="text-gray-500 text-sm">No approved jobs yet.</div>`;
        return;
      }

      snapshot.forEach(doc => {
        const job = { id: doc.id, ...doc.data() };
        const card = document.createElement('div');
        card.className = 'bg-gray-50 border p-3 rounded-lg';
        const dateStr = job.date ? new Date(job.date).toLocaleDateString() : '—';
        card.innerHTML = `
          <div class="text-sm font-semibold">${job.location || 'Unknown location'} — Room ${job.room || '—'}</div>
          <div class="text-xs text-gray-500">${dateStr} | ${job.startTime || ''} - ${job.dueTime || ''}</div>
          <div class="mt-2 text-sm text-gray-700">${job.permanentInstructions || ''}</div>
          <div class="mt-3 text-xs text-gray-500">Manager: ${job.unitManagerName || '—'}</div>
        `;
        jobsList.appendChild(card);
      });
    }, err => {
      console.error('Jobs listener error', err);
    });
}

/* Listener for cleaner doc changes (if we want to reflect external updates) */
function listenCleanerDoc() {
  if (!cleanerDocRef) return;
  return cleanerDocRef.onSnapshot(doc => {
    if (!doc.exists) return;
    const data = doc.data();
    if (data.location) {
      lastLocationEl.textContent = `${data.location.lat.toFixed(5)}, ${data.location.lng.toFixed(5)} (${new Date(data.location.timestamp?.toDate?.() || data.location.timestamp || Date.now()).toLocaleTimeString()})`;
      updateLocalMarker(data.location.lat, data.location.lng);
    }
    if (data.status) selectStatus.value = data.status;
  });
}

/* Attach UI events */
btnBypass.addEventListener('click', async () => {
  const name = inputName.value.trim() || `Cleaner-${Math.floor(Math.random()*9000)+1000}`;
  cleanerName = name;
  // create simple id for testing (use uid from auth in production)
  cleanerId = `test_${name.replace(/\s+/g,'_').toLowerCase()}`;
  cleanerNameEl.textContent = cleanerName;
  loginPanel.classList.add('hidden');
  appPanel.classList.remove('hidden');

  // initial write
  await upsertCleaner(cleanerId, {
    name: cleanerName,
    status: selectStatus.value,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  // Listen to approved jobs and our cleaner doc
  listenApprovedJobs();
  listenCleanerDoc();
});

btnUseAuth.addEventListener('click', () => {
  alert('Auth flow is commented in main.js. Replace the bypass for production by using Firebase auth and set cleanerId to uid.');
});

/* Status changes */
selectStatus.addEventListener('change', async (e) => {
  const status = e.target.value;
  if (!cleanerId) return alert('Please continue as cleaner first.');
  try {
    await upsertCleaner(cleanerId, {
      status,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    // Optional: record status logs in subcollection
    await db.collection('cleaners').doc(cleanerId).collection('status_logs').add({
      status,
      ts: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.error('Failed to update status', err);
  }
});

/* Share location button */
btnShareLocation.addEventListener('click', () => {
  if (!cleanerId) return alert('Please continue as cleaner first.');

  if (!navigator.geolocation) return alert('Geolocation not supported by this browser.');

  btnShareLocation.disabled = true;
  btnShareLocation.textContent = 'Sharing...';

  navigator.geolocation.getCurrentPosition(async position => {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const loc = {
      lat,
      lng,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
      // write to cleaner doc
      await upsertCleaner(cleanerId, {
        location: loc,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      // also write a location log if desired
      await db.collection('cleaners').doc(cleanerId).collection('location_logs').add({
        lat, lng, ts: firebase.firestore.FieldValue.serverTimestamp()
      });

      lastLocationEl.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)} — shared`;
      updateLocalMarker(lat, lng);
    } catch (err) {
      console.error('Failed to share location', err);
      alert('Failed to share location: ' + err.message);
    } finally {
      btnShareLocation.disabled = false;
      btnShareLocation.textContent = 'Share Location';
    }
  }, err => {
    console.error('geolocation error', err);
    alert('Unable to get location: ' + err.message);
    btnShareLocation.disabled = false;
    btnShareLocation.textContent = 'Share Location';
  }, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15000
  });
});

/* Initialize map early so UI looks ready */
initMap();

/* Helpful: cleanup on unload */
window.addEventListener('beforeunload', () => {
  // Optional: mark cleaner as offline/unavailable on unload
  if (cleanerId) {
    db.collection('cleaners').doc(cleanerId).set({
      status: 'Unavailable',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(()=>{});
  }
});
// Add these variables to your existing JavaScript:
let assignedJobsListener = null;
const assignedJobsList = document.getElementById('assignedJobsList');

// Add this function to listen for assigned jobs (add to existing JS):
function startAssignedJobsListener() {
  if (!firebaseEnabled || !cleanerId) {
    assignedJobsList.innerHTML = '<div class="text-gray-500 text-sm">No assigned jobs (cleaner not logged in).</div>';
    return;
  }
  
  // Listen to jobs assigned to this cleaner
  assignedJobsListener = db.collection('jobs')
    .where('assigned.cleanerId', '==', cleanerId)
    .onSnapshot(snapshot => {
      assignedJobsList.innerHTML = '';
      if (snapshot.empty) {
        assignedJobsList.innerHTML = '<div class="text-gray-500 text-sm">No assigned jobs yet.</div>';
        return;
      }
      
      snapshot.forEach(d => {
        const job = { id: d.id, ...d.data() };
        const el = document.createElement('div');
        el.className = 'p-3 rounded border bg-blue-50 border-blue-200';
        const dateStr = job.date ? new Date(job.date).toLocaleDateString() : '—';
        const statusBadge = job.approved ? 
          '<span class="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">Approved</span>' :
          '<span class="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full">Pending</span>';
        
        el.innerHTML = `
          <div class="flex justify-between items-start mb-2">
            <div class="text-sm font-semibold text-blue-900">${escapeHtml(job.location || 'Unknown')} - Room ${escapeHtml(job.room || '—')}</div>
            ${statusBadge}
          </div>
          <div class="text-xs text-gray-600">${escapeHtml(dateStr)} · ${escapeHtml(job.startTime || '')} - ${escapeHtml(job.dueTime || '')}</div>
          <div class="mt-2 text-sm text-gray-700">${escapeHtml(job.permanentInstructions || '')}</div>
          <div class="mt-2 text-xs text-gray-500">Manager: ${escapeHtml(job.unitManagerName || '—')}</div>
        `;
        assignedJobsList.appendChild(el);
      });
    }, err => {
      console.error('Assigned jobs listener error', err);
      assignedJobsList.innerHTML = '<div class="text-red-500 text-sm">Error loading assigned jobs.</div>';
    });
}

// Modify your existing btnBypass click handler to include this call:
// Add this line after listenApprovedJobs(); in your btnBypass click handler:
// startAssignedJobsListener();

// Add cleanup for assigned jobs listener in beforeunload:
// Add this to your existing beforeunload event handler:
// if (assignedJobsListener) assignedJobsListener();
