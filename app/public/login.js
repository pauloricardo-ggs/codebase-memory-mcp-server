const form = document.querySelector('#login-form');
const errorNode = document.querySelector('#login-error');

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  errorNode.hidden = true;
  try {
    const response = await fetch('/admin/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: form.username.value, password: form.password.value })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível entrar.');
    location.replace('/admin/');
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
    button.disabled = false;
    form.password.select();
  }
});
