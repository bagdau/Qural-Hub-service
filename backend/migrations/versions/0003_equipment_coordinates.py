"""equipment coordinates (latitude/longitude editor and the map)

Revision ID: 0003
Revises: 0002
"""
from alembic import op
import sqlalchemy as sa

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('equipment', sa.Column('latitude', sa.Numeric(9, 6), nullable=True))
    op.add_column('equipment', sa.Column('longitude', sa.Numeric(9, 6), nullable=True))
    op.create_check_constraint('ck_eq_lat', 'equipment', 'latitude IS NULL OR (latitude BETWEEN -90 AND 90)')
    op.create_check_constraint('ck_eq_lon', 'equipment', 'longitude IS NULL OR (longitude BETWEEN -180 AND 180)')
    op.create_check_constraint('ck_eq_geo_pair', 'equipment', '(latitude IS NULL) = (longitude IS NULL)')


def downgrade() -> None:
    op.drop_constraint('ck_eq_geo_pair', 'equipment')
    op.drop_constraint('ck_eq_lon', 'equipment')
    op.drop_constraint('ck_eq_lat', 'equipment')
    op.drop_column('equipment', 'longitude')
    op.drop_column('equipment', 'latitude')
