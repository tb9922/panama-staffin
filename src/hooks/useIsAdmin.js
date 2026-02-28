export default function useIsAdmin(user) {
  return user?.role === 'admin';
}
