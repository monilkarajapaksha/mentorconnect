import { Hono } from 'hono';
import type { AppEnv } from './env';
import { handleError, notFound } from './lib/errors';
import { requireAuth, sameOriginForMutations } from './middleware/auth';
import auth from './routes/auth';
import calls from './routes/calls';
import clients from './routes/clients';
import dashboard from './routes/dashboard';
import meetings from './routes/meetings';
import mentors, { timeOff } from './routes/mentors';

const app = new Hono<AppEnv>();

app.use('/api/*', sameOriginForMutations);
app.use('/api/*', requireAuth);

app.route('/api/auth', auth);
app.route('/api/clients', clients);
app.route('/api/calls', calls);
app.route('/api/mentors', mentors);
app.route('/api/time-off', timeOff);
app.route('/api/meetings', meetings);
app.route('/api', dashboard);

app.onError(handleError);
app.notFound(notFound);

export default app;
