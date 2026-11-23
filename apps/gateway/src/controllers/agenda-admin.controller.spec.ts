import { UnauthorizedException } from '@nestjs/common';
import { adminTokens, whoIs } from './agenda-admin.controller';

describe('the agenda admin token', () => {
  it('reads one token as "admin"', () => {
    expect(whoIs('Bearer s3cret', adminTokens('s3cret'))).toBe('admin');
  });

  it('reads named tokens, so revisions say who', () => {
    const tokens = adminTokens('ender:aaaa, maria:bbbb');
    expect(whoIs('Bearer bbbb', tokens)).toBe('maria');
    expect(whoIs('Bearer aaaa', tokens)).toBe('ender');
  });

  it('refuses a wrong token, a missing one, and everything when none is set', () => {
    expect(() => whoIs('Bearer nope', adminTokens('s3cret'))).toThrow(
      UnauthorizedException,
    );
    expect(() => whoIs(undefined, adminTokens('s3cret'))).toThrow(
      UnauthorizedException,
    );
    expect(() => whoIs('Bearer ', adminTokens(''))).toThrow(
      UnauthorizedException,
    );
  });
});
