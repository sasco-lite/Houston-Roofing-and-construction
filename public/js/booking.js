import { observeAuth } from './auth.js';

let bookingState = {
  step: 1,
  serviceType: 'residential-asphalt-replacement',
  propertyType: 'Single-family home',
  date: '',
  time: '',
  slotKey: '',
  address: { street: '', zip: '' },
  notes: '',
  currentUser: null
};

document.addEventListener('DOMContentLoaded', () => {
  observeAuth((user) => {
    bookingState.currentUser = user;
    renderStep();
  });

  const nextBtn = document.getElementById('wizardNext');
  const prevBtn = document.getElementById('wizardPrev');

  if (nextBtn) nextBtn.addEventListener('click', handleNext);
  if (prevBtn) prevBtn.addEventListener('click', handlePrev);
  
  const datePicker = document.getElementById('slotDatePicker');
  if (datePicker) {
    // Restrict to today onwards
    const today = new Date().toISOString().split('T')[0];
    datePicker.min = today;
    datePicker.value = today;
    datePicker.addEventListener('change', (e) => fetchSlots(e.target.value));
    fetchSlots(today);
  }
});

async function fetchSlots(date) {
  const container = document.getElementById('slotsContainer');
  container.innerHTML = '<p>Loading open timeslots...</p>';

  try {
    const res = await fetch(`/api/slots?date=${date}`);
    const data = await res.json();
    
    container.innerHTML = '';
    if (!data.slots || data.slots.length === 0) {
      container.innerHTML = '<p>No open slots for this date.</p>';
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'slot-grid';

    data.slots.forEach(slot => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-btn' + (bookingState.slotKey === slot.key ? ' selected' : '');
      btn.textContent = slot.time;
      btn.disabled = !slot.available;
      
      btn.addEventListener('click', () => {
        document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        bookingState.slotKey = slot.key;
        bookingState.date = date;
        bookingState.time = slot.time;
      });
      grid.appendChild(btn);
    });
    container.appendChild(grid);
  } catch {
    container.innerHTML = '<p>Error loading slots.</p>';
  }
}

function handleNext() {
  if (bookingState.step === 1) {
    const sType = document.querySelector('input[name="serviceType"]:checked');
    if (sType) bookingState.serviceType = sType.value;
    bookingState.step = 2;
  } else if (bookingState.step === 2) {
    if (!bookingState.slotKey) {
      alert('Please select an inspection time.');
      return;
    }
    bookingState.step = 3;
  } else if (bookingState.step === 3) {
    const street = document.getElementById('inputStreet').value.trim();
    const zip = document.getElementById('inputZip').value.trim();
    const notes = document.getElementById('inputNotes').value.trim();
    const pType = document.getElementById('inputPropertyType').value;

    if (!street || !zip) {
      alert('Please supply both street and Houston-area ZIP code.');
      return;
    }

    bookingState.address = { street, zip };
    bookingState.notes = notes;
    bookingState.propertyType = pType;
    bookingState.step = 4;
  } else if (bookingState.step === 4) {
    submitBooking();
    return;
  }
  renderStep();
}

function handlePrev() {
  if (bookingState.step > 1) {
    bookingState.step--;
    renderStep();
  }
}

function renderStep() {
  document.querySelectorAll('.wizard-panel').forEach(p => p.style.display = 'none');
  const activePanel = document.getElementById(`stepPanel${bookingState.step}`);
  if (activePanel) activePanel.style.display = 'block';

  document.querySelectorAll('.step-node').forEach((node, idx) => {
    node.classList.toggle('active', idx + 1 === bookingState.step);
  });

  const prevBtn = document.getElementById('wizardPrev');
  const nextBtn = document.getElementById('wizardNext');
  
  if (prevBtn) prevBtn.style.visibility = bookingState.step === 1 ? 'hidden' : 'visible';
  if (nextBtn) {
    if (bookingState.step === 4) {
      nextBtn.textContent = bookingState.currentUser ? 'Confirm & Book' : 'Sign in to Confirm';
    } else {
      nextBtn.textContent = 'Continue';
    }
  }

  if (bookingState.step === 4) {
    const summary = document.getElementById('bookingSummary');
    if (summary) {
      summary.innerHTML = `
        <p><strong>Service:</strong> ${bookingState.serviceType}</p>
        <p><strong>Time:</strong> ${bookingState.date} at ${bookingState.time}</p>
        <p><strong>Property:</strong> ${bookingState.address.street}, ${bookingState.address.zip} (${bookingState.propertyType})</p>
      `;
    }
  }
}

async function submitBooking() {
  if (!bookingState.currentUser) {
    window.location.href = `/login.html?redirect=book.html`;
    return;
  }

  try {
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slotKey: bookingState.slotKey,
        date: bookingState.date,
        time: bookingState.time,
        serviceType: bookingState.serviceType,
        propertyType: bookingState.propertyType,
        address: bookingState.address,
        notes: bookingState.notes
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to complete booking');

    window.location.href = '/dashboard.html?booked=true';
  } catch (err) {
    alert(err.message);
  }
}