#!/usr/bin/env python3
"""Conservative *estimated* request allowance for an operator-priced BYOK model.

This is NOT spend enforcement: real providers may count/cache/bill tokens
differently, ignore generation limits or change prices. YAG enforces only the
returned per-process request-count ceiling, not dollars or token counts.
"""
import datetime
from decimal import Decimal, InvalidOperation, ROUND_FLOOR
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

MAX_BYTES = 8192
MAX_CATALOG_AGE_DAYS = 7


def positive_decimal(value, name, upper):
    if not isinstance(value, str) or len(value) > 32:
        raise ValueError(name + ' must be a decimal string')
    try:
        number = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError(name + ' is invalid') from exc
    if not number.is_finite() or not 0 < number <= upper:
        raise ValueError(name + ' is outside the accepted bounds')
    return number


def estimate(path, now=None):
    file = Path(path)
    if file.is_symlink() or not file.is_file() or not 0 < file.stat().st_size <= MAX_BYTES:
        raise ValueError('Pricing policy must be a small regular file, not a symlink')
    try:
        policy = json.loads(file.read_text('utf-8'))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError('Malformed pricing policy') from exc
    if not isinstance(policy, dict) or set(policy) != {
        'schema_version','model_id','currency','source_url','checked_at_utc',
        'input_usd_per_million','output_usd_per_million',
        'assumed_max_input_tokens','assumed_max_output_tokens',
        'safety_multiplier','planning_budget_usd'
    } or policy['schema_version'] != 1:
        raise ValueError('Unexpected pricing policy schema or missing provenance')
    if (not isinstance(policy['model_id'],str) or not
            re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:/-]{0,254}',policy['model_id'])):
        raise ValueError('Model identifier is missing or invalid')
    if policy['currency'] != 'USD':
        raise ValueError('Unsupported currency: only explicit USD prices are accepted')
    raw_url = policy['source_url']
    if not isinstance(raw_url,str) or not 12 <= len(raw_url) <= 512:
        raise ValueError('Source URL is missing')
    url = urlsplit(raw_url)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.fragment:
        raise ValueError('Price source must be an HTTPS URL without credentials or fragment')
    stamp = policy['checked_at_utc']
    if not isinstance(stamp,str) or len(stamp)>40:
        raise ValueError('Missing UTC pricing review date')
    try:
        reviewed = datetime.datetime.fromisoformat(stamp)
    except ValueError as exc:
        raise ValueError('Invalid pricing review timestamp') from exc
    if reviewed.tzinfo is None or reviewed.utcoffset() != datetime.timedelta(0):
        raise ValueError('Pricing review timestamp must use UTC')
    now = now or datetime.datetime.now(datetime.timezone.utc)
    age = now-reviewed
    if age < datetime.timedelta(minutes=-5) or age > datetime.timedelta(days=MAX_CATALOG_AGE_DAYS):
        raise ValueError('Pricing review has expired or is from the future')
    input_price = positive_decimal(policy['input_usd_per_million'], 'Input price', Decimal('100000'))
    output_price = positive_decimal(policy['output_usd_per_million'], 'Output price', Decimal('100000'))
    margin = positive_decimal(policy['safety_multiplier'], 'Safety multiplier', Decimal('10'))
    if margin < Decimal('1.5'):
        raise ValueError('Safety multiplier must be at least 1.5')
    budget = positive_decimal(policy['planning_budget_usd'], 'Planning budget', Decimal('1000000'))
    limits = []
    for key in ('assumed_max_input_tokens','assumed_max_output_tokens'):
        n = policy[key]
        if type(n) is not int or not 1 <= n <= 1_000_000:
            raise ValueError(key + ' must be a positive bounded integer')
        limits.append(n)
    per_call = ((Decimal(limits[0])*input_price + Decimal(limits[1])*output_price)
                / Decimal(1_000_000)) * margin
    count = int((budget/per_call).to_integral_value(rounding=ROUND_FLOOR))
    if count < 1:
        raise ValueError('Planning budget does not cover one estimated request')
    return {'model_id':policy['model_id'],
            'estimated_worst_case_usd':str(per_call.normalize()),
            'suggested_max_requests_per_run':min(1_000_000,count),
            'source_url':raw_url,
            'checked_at_utc':stamp,
            'warning':'Planning estimate only; not a financial or token quota.'}
