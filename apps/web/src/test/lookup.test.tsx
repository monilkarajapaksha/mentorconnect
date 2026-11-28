import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, client, mockFetch, renderApp } from './utils';

afterEach(() => vi.unstubAllGlobals());

const stats = {
  'GET /api/stats': () => ({
    json: { total: 3, noCalls: 0, counts: { follow_up_2: 2, declined: 1 } },
  }),
};

describe('lookup flow', () => {
  it('focuses the phone box on load and again when "/" is pressed', async () => {
    mockFetch(stats);
    renderApp('/');
    const box = await screen.findByLabelText('Phone number');
    expect(box).toHaveFocus();
    box.blur();
    await userEvent.keyboard('/');
    expect(box).toHaveFocus();
  });

  it('shows status count cards that link to the filtered clients list', async () => {
    mockFetch(stats);
    renderApp('/');
    const card = await screen.findByRole('link', { name: /Not answered/ });
    expect(card).toHaveAttribute('href', '/clients?status=declined');
    expect(screen.getByRole('link', { name: /Any follow-up/ })).toHaveTextContent('2');
  });

  it('new number: shows "New number" with the phone prefilled, requires a name, then opens the client', async () => {
    const lookupPhones: string[] = [];
    const fetchMock = mockFetch({
      ...stats,
      'GET /api/clients/lookup': ({ url }) => {
        lookupPhones.push(url.searchParams.get('phone')!);
        return { json: { found: false, normalizedPhone: '+94771234567' } };
      },
      'POST /api/clients': () => ({
        status: 201,
        json: { client: client({ current_status: null }) },
      }),
      'GET /api/clients/c1': () => ({
        json: {
          client: client({ current_status: null }),
          calls: [],
          suggestedStatus: 'follow_up_1',
        },
      }),
    });
    renderApp('/');
    await userEvent.type(await screen.findByLabelText('Phone number'), '077 123 4567{Enter}');

    expect(await screen.findByRole('heading', { name: 'New number' })).toBeInTheDocument();
    expect(lookupPhones).toEqual(['077 123 4567']);
    expect(screen.getByLabelText('Phone')).toHaveValue('+94771234567');

    // name is required
    await userEvent.click(screen.getByRole('button', { name: 'Add client' }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

    await userEvent.type(screen.getByLabelText('Name'), 'Nimal Perera');
    await userEvent.click(screen.getByRole('button', { name: 'Add client' }));

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({
      phone: '+94771234567',
      name: 'Nimal Perera',
    });
    expect(await screen.findByRole('heading', { name: 'Nimal Perera' })).toBeInTheDocument();
    expect(screen.getByText(/No calls logged yet/)).toBeInTheDocument();
  });

  it('existing client: goes straight to the client card with the call timeline', async () => {
    mockFetch({
      ...stats,
      'GET /api/clients/lookup': () => ({
        json: { found: true, client: client(), calls: [call()], suggestedStatus: 'follow_up_2' },
      }),
      'GET /api/clients/c1': () => ({
        json: {
          client: client(),
          calls: [call({ id: 'k2', status: 'follow_up_2', summary: 'Second call' }), call()],
          suggestedStatus: 'follow_up_3',
        },
      }),
    });
    renderApp('/?phone=0771234567');
    expect(await screen.findByRole('heading', { name: 'Nimal Perera' })).toBeInTheDocument();
    expect(screen.getByText('Lanka Traders')).toBeInTheDocument();
    const items = screen.getAllByTestId('call-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Second call'); // newest first
    expect(items[1]).toHaveTextContent('First call about pricing');
    expect(screen.getAllByRole('button', { name: /Edit \/ Update/ })).toHaveLength(2);
  });

  it('shows a friendly error for an invalid number', async () => {
    mockFetch({
      ...stats,
      'GET /api/clients/lookup': () => ({
        status: 400,
        json: { error: { code: 'INVALID_PHONE', message: 'Invalid phone number' } },
      }),
    });
    renderApp('/');
    await userEvent.type(await screen.findByLabelText('Phone number'), 'abc{Enter}');
    expect(await screen.findByText(/doesn.t look like a valid phone number/)).toBeInTheDocument();
  });
});

describe('auth guard', () => {
  it('redirects to /login when not signed in', async () => {
    mockFetch({
      'GET /api/auth/me': () => ({
        status: 401,
        json: { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
      }),
    });
    renderApp('/clients');
    expect(await screen.findByRole('form', { name: 'Login' })).toBeInTheDocument();
  });

  it('logs in and shows the admin name + Logout in the header', async () => {
    let authed = false;
    mockFetch({
      'GET /api/auth/me': () =>
        authed
          ? { json: { admin: { id: 'a1', email: 'x@y.z', name: 'Test Admin' } } }
          : { status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'x' } } },
      'POST /api/auth/login': () => {
        authed = true;
        return { json: { admin: { id: 'a1', email: 'x@y.z', name: 'Test Admin' } } };
      },
      ...stats,
    });
    renderApp('/');
    await userEvent.type(await screen.findByLabelText('Email'), 'x@y.z');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument());
    expect(screen.getByText('Test Admin')).toBeInTheDocument();
  });

  it('shows the server error on bad credentials', async () => {
    mockFetch({
      'GET /api/auth/me': () => ({
        status: 401,
        json: { error: { code: 'UNAUTHENTICATED', message: 'x' } },
      }),
      'POST /api/auth/login': () => ({
        status: 401,
        json: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } },
      }),
    });
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'x@y.z');
    await userEvent.type(screen.getByLabelText('Password'), 'bad');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });
});
