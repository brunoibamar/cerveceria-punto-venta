const USER_KEY = 'pos_current_user';
const ADMIN_PIN_KEY = 'pos_admin_pin';

const USERS = [
  { username: 'admin', pin: '1234', role: 'admin', name: 'Administrador' },
  { username: 'cajero', pin: '1234', role: 'cajero', name: 'Cajero' },
  { username: 'invitado', pin: '', role: 'cajero', name: 'Invitado' },
];

function getAdminPin() {
  return localStorage.getItem(ADMIN_PIN_KEY) || '1234';
}

export function setAdminPin(pin) {
  localStorage.setItem(ADMIN_PIN_KEY, pin);
}

export function verifyAdminPin(pin) {
  return pin === getAdminPin();
}

export function loginAsAdmin(pin) {
  if (!verifyAdminPin(pin)) {
    return null;
  }
  const session = {
    username: 'admin',
    name: 'Administrador',
    role: 'admin',
    loginAt: Date.now(),
  };
  sessionStorage.setItem(USER_KEY, JSON.stringify(session));
  return session;
}

export function loginAsGuest() {
  const session = {
    username: 'invitado',
    name: 'Invitado',
    role: 'cajero',
    loginAt: Date.now(),
  };
  sessionStorage.setItem(USER_KEY, JSON.stringify(session));
  return session;
}

export function login(username, pin) {
  const user = USERS.find(
    (u) => u.username === username.trim().toLowerCase() && u.pin === pin,
  );
  if (!user) {
    return null;
  }
  const session = {
    username: user.username,
    name: user.name,
    role: user.role,
    loginAt: Date.now(),
  };
  sessionStorage.setItem(USER_KEY, JSON.stringify(session));
  return session;
}

export function logout() {
  sessionStorage.removeItem(USER_KEY);
}

export function getCurrentUser() {
  try {
    return JSON.parse(sessionStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

export function isAdmin() {
  const user = getCurrentUser();
  return Boolean(user && user.role === 'admin');
}
