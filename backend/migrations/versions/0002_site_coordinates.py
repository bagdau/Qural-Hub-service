"""site coordinates for the OpenStreetMap integration

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('sites', sa.Column('latitude', sa.Numeric(9, 6), nullable=True))
    op.add_column('sites', sa.Column('longitude', sa.Numeric(9, 6), nullable=True))
    op.create_check_constraint('ck_site_lat', 'sites', 'latitude IS NULL OR (latitude BETWEEN -90 AND 90)')
    op.create_check_constraint('ck_site_lon', 'sites', 'longitude IS NULL OR (longitude BETWEEN -180 AND 180)')
    op.create_check_constraint('ck_site_geo_pair', 'sites', '(latitude IS NULL) = (longitude IS NULL)')


def downgrade() -> None:
    op.drop_constraint('ck_site_geo_pair', 'sites')
    op.drop_constraint('ck_site_lon', 'sites')
    op.drop_constraint('ck_site_lat', 'sites')
    op.drop_column('sites', 'longitude')
    op.drop_column('sites', 'latitude')
