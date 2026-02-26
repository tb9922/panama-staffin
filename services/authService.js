import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { AuthenticationError } from '../errors.js';

export async function login(username, password) {
  const user = config.users.find(u => u.username === username);
  if (!user) throw new AuthenticationError('Invalid credentials');
  const valid = await bcrypt.compare(password, user.hash);
  if (!valid) throw new AuthenticationError('Invalid credentials');
  const token = jwt.sign({ username: user.username, role: user.role }, config.jwtSecret, { expiresIn: '12h' });
  return { username: user.username, role: user.role, token };
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
}
